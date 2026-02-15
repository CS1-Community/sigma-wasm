import { WebGPUEngine, Scene, ArcRotateCamera, Vector3, MeshBuilder, ShaderMaterial, ShaderLanguage, ShaderStore } from '@babylonjs/core';
import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/inspector";
import type { WasmBabylonMandelbulb, WasmModuleBabylonMandelbulb } from '../types';
import { loadWasmModule, validateWasmModule } from '../wasm/loader';

let wasmModuleExports: {
    default: () => Promise<unknown>;
    get_palette: (id: number) => any;
    get_default_config: () => any;
    get_flat_palette: (id: number) => Float32Array;
} | null = null;

const getInitWasm = async (): Promise<unknown> => {
    console.log('[BabylonMandelbulb] getInitWasm called');
    if (!wasmModuleExports) {
        console.log('[BabylonMandelbulb] importing WASM module...');
        // Match hello-wasm pattern: explicit unknown type for import result
        const moduleUnknown: unknown = await import('../../pkg/wasm_babylon_mandelbulb/wasm_babylon_mandelbulb.js');
        console.log('[BabylonMandelbulb] import successful', moduleUnknown);

        if (typeof moduleUnknown !== 'object' || moduleUnknown === null) {
            throw new Error('Imported module is not an object');
        }

        // Validate required exports exist
        if (!('default' in moduleUnknown) || typeof (moduleUnknown as any).default !== 'function') {
            throw new Error('Module missing default export or it is not a function');
        }
        if (!('get_palette' in moduleUnknown) || typeof (moduleUnknown as any).get_palette !== 'function') {
            throw new Error('Module missing get_palette export');
        }
        if (!('get_default_config' in moduleUnknown) || typeof (moduleUnknown as any).get_default_config !== 'function') {
            throw new Error('Module missing get_default_config export');
        }
        if (!('get_flat_palette' in moduleUnknown) || typeof (moduleUnknown as any).get_flat_palette !== 'function') {
            throw new Error('Module missing get_flat_palette export');
        }

        // Assign with safer typing
        wasmModuleExports = {
            default: (moduleUnknown as any).default,
            get_palette: (moduleUnknown as any).get_palette,
            get_default_config: (moduleUnknown as any).get_default_config,
            get_flat_palette: (moduleUnknown as any).get_flat_palette,
        };
    }
    return wasmModuleExports.default();
};

function validateMandelbulbModule(exports: unknown): WasmModuleBabylonMandelbulb | null {
    if (!validateWasmModule(exports)) return null;
    if (!wasmModuleExports) return null;

    return {
        memory: (exports as any).memory,
        get_palette: wasmModuleExports.get_palette,
        get_default_config: wasmModuleExports.get_default_config,
        get_flat_palette: wasmModuleExports.get_flat_palette,
    };
}

const STATE: WasmBabylonMandelbulb & {
    engine: WebGPUEngine | null;
    scene: Scene | null;
    config: any;
    paletteId: number;
} = {
    wasmModule: null,
    wasmModulePath: '../pkg/wasm_babylon_mandelbulb',
    engine: null,
    scene: null,
    config: null,
    paletteId: 0,
};

// WGSL Mandelbulb Shaders (Babylon-flavored WGSL syntax)
const mandelbulbVertexWGSL = `
#include<sceneUboDeclaration>
#include<meshUboDeclaration>

attribute position : vec3<f32>;

varying vPositionW : vec3<f32>;

@vertex
fn main(input : VertexInputs) -> FragmentInputs {
    let worldPos = mesh.world * vec4<f32>(vertexInputs.position, 1.0);
    vertexOutputs.position = scene.viewProjection * worldPos;
    vertexOutputs.vPositionW = worldPos.xyz;
}
`;

const mandelbulbFragmentWGSL = `
varying vPositionW : vec3<f32>;

uniform power : f32;
uniform maxIters : f32;
uniform bailOut : f32;
uniform cameraPosX : f32;
uniform cameraPosY : f32;
uniform cameraPosZ : f32;
uniform lightPosX : f32;
uniform lightPosY : f32;
uniform lightPosZ : f32;
uniform p0r : f32;
uniform p0g : f32;
uniform p0b : f32;
uniform p1r : f32;
uniform p1g : f32;
uniform p1b : f32;
uniform p2r : f32;
uniform p2g : f32;
uniform p2b : f32;
uniform p3r : f32;
uniform p3g : f32;
uniform p3b : f32;
uniform p4r : f32;
uniform p4g : f32;
uniform p4b : f32;

fn getPalette(idx : i32) -> vec3<f32> {
    if (idx == 0) { return vec3<f32>(uniforms.p0r, uniforms.p0g, uniforms.p0b); }
    if (idx == 1) { return vec3<f32>(uniforms.p1r, uniforms.p1g, uniforms.p1b); }
    if (idx == 2) { return vec3<f32>(uniforms.p2r, uniforms.p2g, uniforms.p2b); }
    if (idx == 3) { return vec3<f32>(uniforms.p3r, uniforms.p3g, uniforms.p3b); }
    return vec3<f32>(uniforms.p4r, uniforms.p4g, uniforms.p4b);
}

fn mandelbulbDist(pos : vec3<f32>) -> vec2<f32> {
    var z = pos;
    var dr = 1.0;
    var r = 0.0;
    var iterations : f32 = 0.0;
    let pw = uniforms.power;
    let mi = i32(uniforms.maxIters);
    let bo = uniforms.bailOut;

    for (var i = 0; i < mi; i = i + 1) {
        iterations = f32(i);
        r = length(z);
        if (r > bo) { break; }

        let theta = acos(clamp(z.z / max(r, 1e-6), -1.0, 1.0));
        let phi = atan2(z.y, z.x);
        dr = pow(r, max(pw - 1.0, 0.0)) * pw * dr + 1.0;

        let zr = pow(r, max(pw, 0.001));
        let nTheta = theta * pw;
        let nPhi = phi * pw;

        z = zr * vec3<f32>(sin(nTheta) * cos(nPhi), sin(nTheta) * sin(nPhi), cos(nTheta));
        z = z + pos;
    }
    return vec2<f32>(0.5 * log(max(r, 1e-6)) * r / dr, iterations);
}

fn calcNormal(p : vec3<f32>) -> vec3<f32> {
    let e = vec2<f32>(0.0005, 0.0);
    return normalize(vec3<f32>(
        mandelbulbDist(p + e.xyy).x - mandelbulbDist(p - e.xyy).x,
        mandelbulbDist(p + e.yxy).x - mandelbulbDist(p - e.yxy).x,
        mandelbulbDist(p + e.yyx).x - mandelbulbDist(p - e.yyx).x
    ));
}

fn rayMarch(ro : vec3<f32>, rd : vec3<f32>) -> vec4<f32> {
    var t = 0.0;
    let lp = vec3<f32>(uniforms.lightPosX, uniforms.lightPosY, uniforms.lightPosZ);
    let mi = uniforms.maxIters;
    for (var i = 0; i < 200; i = i + 1) {
        let p = ro + rd * t;
        let res = mandelbulbDist(p);
        let d = res.x;
        if (d < 0.0005) {
            let normal = calcNormal(p);
            let lightDir = normalize(lp - p);
            let diff = max(dot(normal, lightDir), 0.0);

            let iter = res.y / mi;
            let colorIdx = i32(iter * 4.0);
            let c0 = getPalette(min(colorIdx, 4));
            let c1 = getPalette(min(colorIdx + 1, 4));
            let color = mix(c0, c1, fract(iter * 4.0));

            return vec4<f32>(color * (diff + 0.15), 1.0);
        }
        t += d;
        if (t > 8.0) { break; }
    }
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
}

@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
    let ro = vec3<f32>(uniforms.cameraPosX, uniforms.cameraPosY, uniforms.cameraPosZ);
    let rd = normalize(fragmentInputs.vPositionW - ro);
    let marchRes = rayMarch(ro, rd);
    if (marchRes.a <= 0.0) {
        discard;
    }
    fragmentOutputs.color = marchRes;
}
`;

export const init = async (): Promise<void> => {
    console.log('[BabylonMandelbulb] init called');
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const powerSlider = document.getElementById('power-slider') as HTMLInputElement;
    const powerValue = document.getElementById('power-value');
    const paletteSelect = document.getElementById('palette-select') as HTMLSelectElement;
    const iterSlider = document.getElementById('iter-slider') as HTMLInputElement;
    const iterValue = document.getElementById('iter-value');
    const statsEl = document.getElementById('stats');

    if (!canvas) {
        console.error('[BabylonMandelbulb] Canvas element "renderCanvas" not found');
        if (errorEl) errorEl.textContent = 'Error: Canvas element not found';
        return;
    }

    try {
        console.log('[BabylonMandelbulb] Loading WASM module...');
        STATE.wasmModule = await loadWasmModule<WasmModuleBabylonMandelbulb>(
            getInitWasm,
            validateMandelbulbModule
        );
        STATE.config = STATE.wasmModule.get_default_config();

        if (!(await WebGPUEngine.IsSupportedAsync)) {
            console.error('[BabylonMandelbulb] WebGPU not supported');
            throw new Error('WebGPU is not supported in this browser.');
        }
        console.log('[BabylonMandelbulb] WebGPU is supported');

        const engine = new WebGPUEngine(canvas);
        await engine.initAsync();
        STATE.engine = engine;

        const scene = new Scene(engine);
        STATE.scene = scene;

        if (window.location.search.includes('debug=true')) {
            scene.debugLayer.show();
        }

        const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 2, 4, Vector3.Zero(), scene);
        camera.attachControl(canvas, true);
        camera.lowerRadiusLimit = 1.0;
        camera.upperRadiusLimit = 10;

        // Register shaders in the WGSL shader store (NOT the GLSL store)
        ShaderStore.ShadersStoreWGSL["mandelbulbVertexShader"] = mandelbulbVertexWGSL;
        ShaderStore.ShadersStoreWGSL["mandelbulbFragmentShader"] = mandelbulbFragmentWGSL;

        const mandelbulbMesh = MeshBuilder.CreateBox("mandelbulbMesh", { size: 2.2 }, scene);
        mandelbulbMesh.billboardMode = 7; // Mesh.BILLBOARDMODE_ALL
        mandelbulbMesh.isPickable = true;

        const shaderMaterial = new ShaderMaterial("mandelbulb", scene, {
            vertex: "mandelbulb",
            fragment: "mandelbulb",
        }, {
            attributes: ["position"],
            uniforms: [
                "power", "maxIters", "bailOut",
                "cameraPosX", "cameraPosY", "cameraPosZ",
                "lightPosX", "lightPosY", "lightPosZ",
                "p0r", "p0g", "p0b",
                "p1r", "p1g", "p1b",
                "p2r", "p2g", "p2b",
                "p3r", "p3g", "p3b",
                "p4r", "p4g", "p4b",
            ],
            uniformBuffers: ["Scene", "Mesh"],
            shaderLanguage: ShaderLanguage.WGSL,
        });

        shaderMaterial.backFaceCulling = false;
        mandelbulbMesh.material = shaderMaterial;

        scene.onBeforeRenderObservable.add(() => {
            if (!STATE.config || !STATE.wasmModule) return;

            shaderMaterial.setFloat('power', STATE.config.power);
            shaderMaterial.setFloat('maxIters', STATE.config.max_iters);
            shaderMaterial.setFloat('bailOut', STATE.config.bail_out);

            shaderMaterial.setFloat('cameraPosX', camera.position.x);
            shaderMaterial.setFloat('cameraPosY', camera.position.y);
            shaderMaterial.setFloat('cameraPosZ', camera.position.z);

            shaderMaterial.setFloat('lightPosX', STATE.config.light_pos[0]);
            shaderMaterial.setFloat('lightPosY', STATE.config.light_pos[1]);
            shaderMaterial.setFloat('lightPosZ', STATE.config.light_pos[2]);

            const fp = STATE.wasmModule.get_flat_palette(STATE.paletteId);
            shaderMaterial.setFloat('p0r', fp[0]); shaderMaterial.setFloat('p0g', fp[1]); shaderMaterial.setFloat('p0b', fp[2]);
            shaderMaterial.setFloat('p1r', fp[4]); shaderMaterial.setFloat('p1g', fp[5]); shaderMaterial.setFloat('p1b', fp[6]);
            shaderMaterial.setFloat('p2r', fp[8]); shaderMaterial.setFloat('p2g', fp[9]); shaderMaterial.setFloat('p2b', fp[10]);
            shaderMaterial.setFloat('p3r', fp[12]); shaderMaterial.setFloat('p3g', fp[13]); shaderMaterial.setFloat('p3b', fp[14]);
            shaderMaterial.setFloat('p4r', fp[16]); shaderMaterial.setFloat('p4g', fp[17]); shaderMaterial.setFloat('p4b', fp[18]);
        });

        engine.runRenderLoop(() => {
            scene.render();
            if (statsEl) statsEl.textContent = `FPS: ${engine.getFps().toFixed(0)}`;
        });


        window.addEventListener('resize', () => engine.resize());

        powerSlider.addEventListener('input', () => {
            STATE.config.power = parseFloat(powerSlider.value);
            if (powerValue) powerValue.textContent = STATE.config.power.toFixed(1);
        });

        iterSlider.addEventListener('input', () => {
            STATE.config.max_iters = parseInt(iterSlider.value);
            if (iterValue) iterValue.textContent = STATE.config.max_iters.toString();
        });

        paletteSelect.addEventListener('change', () => {
            STATE.paletteId = parseInt(paletteSelect.value);
        });

        if (loadingEl) loadingEl.style.display = 'none';

    } catch (err: any) {
        console.error(err);
        if (errorEl) errorEl.textContent = `Error: ${err.message}`;
        if (loadingEl) loadingEl.style.display = 'none';
    }
};
