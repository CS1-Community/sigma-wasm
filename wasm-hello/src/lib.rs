use wasm_bindgen::prelude::*;
use std::sync::{LazyLock, Mutex};

/// Simple state structure for the hello-wasm template
/// This demonstrates the state management pattern used throughout the project.
/// 
/// **Learning Point**: In Rust WASM, we can't have global mutable state directly.
/// Instead, we use `LazyLock<Mutex<State>>` which:
/// - `LazyLock`: Initializes the value on first access (lazy initialization)
/// - `Mutex`: Provides thread-safe access to mutable data
/// 
/// Even though WASM runs single-threaded, `Mutex` satisfies Rust's borrow checker
/// when we need mutable access to shared state across function calls.
struct HelloState {
    /// Counter value that can be incremented
    counter: i32,
    /// Message string that can be set and retrieved
    message: String,
}

impl HelloState {
    /// Create a new HelloState with default values
    fn new() -> Self {
        HelloState {
            counter: 0,
            message: String::from("Rust WASM is so Sigma!"),
        }
    }
    
    /// Get the current counter value
    fn get_counter(&self) -> i32 {
        self.counter
    }
    
    /// Increment the counter by 1
    fn increment_counter(&mut self) {
        self.counter += 1;
    }
    
    /// Get the current message
    fn get_message(&self) -> String {
        self.message.clone()
    }
    
    /// Set a new message
    fn set_message(&mut self, message: String) {
        self.message = message;
    }
}

/// Global state using the LazyLock<Mutex<State>> pattern
/// 
/// **Learning Point**: This is the same pattern used in wasm-astar and other modules.
/// The state is initialized on first access and can be safely mutated across
/// multiple WASM function calls.
/// 
/// **To extend this template**: Add new fields to `HelloState` and implement
/// getter/setter methods. Then expose them via `#[wasm_bindgen]` functions below.
static HELLO_STATE: LazyLock<Mutex<HelloState>> = LazyLock::new(|| Mutex::new(HelloState::new()));

/// Initialize the WASM module
/// This is called once when the module is first loaded.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// Initialize the hello-wasm module
/// 
/// **Learning Point**: This function is called from TypeScript after the WASM module loads.
/// You can add initialization logic here, such as setting up default values or
/// preparing resources.
/// 
/// @param initial_counter - Optional starting value for the counter (defaults to 0)
#[wasm_bindgen]
pub fn wasm_init(initial_counter: i32) {
    let mut state = HELLO_STATE.lock().unwrap();
    state.counter = initial_counter;
}

/// Get the current counter value
/// 
/// **Learning Point**: This demonstrates how to read from the global state.
/// We lock the mutex, read the value, and return it. The lock is automatically
/// released when the function returns.
/// 
/// @returns The current counter value
#[wasm_bindgen]
pub fn get_counter() -> i32 {
    let state = HELLO_STATE.lock().unwrap();
    state.get_counter()
}

/// Increment the counter by 1
/// 
/// **Learning Point**: This demonstrates how to mutate the global state.
/// We lock the mutex, call a mutable method, and the lock is released automatically.
/// 
/// **To extend**: You could add parameters like `increment_by(amount: i32)` to
/// increment by a specific value instead of always 1.
#[wasm_bindgen]
pub fn increment_counter() {
    let mut state = HELLO_STATE.lock().unwrap();
    state.increment_counter();
}

/// Get the current message
/// 
/// **Learning Point**: Strings in Rust need to be converted to JavaScript strings.
/// `wasm-bindgen` handles this automatically when you return a `String` from a
/// `#[wasm_bindgen]` function.
/// 
/// @returns The current message as a JavaScript string
#[wasm_bindgen]
pub fn get_message() -> String {
    let state = HELLO_STATE.lock().unwrap();
    state.get_message()
}

/// Set a new message
/// 
/// **Learning Point**: JavaScript strings are automatically converted to Rust `String`
/// when passed as parameters to `#[wasm_bindgen]` functions.
/// 
/// **To extend**: You could add validation, length limits, or formatting here.
/// 
/// @param message - The new message to set
#[wasm_bindgen]
pub fn set_message(message: String) {
    let mut state = HELLO_STATE.lock().unwrap();
    state.set_message(message);
}

