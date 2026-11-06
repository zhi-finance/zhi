//! zhi-core: the deterministic heart of the Zhi harness.
//!
//! "The model plans once. The subnet verifies. The chain enforces."
//! This crate is the middle of that sentence's machinery: it turns a frozen, signed rule tree
//! plus logged market inputs into intents, with no model calls and no floating point, so every
//! decision can be replayed bit-for-bit.

pub mod canonical;
pub mod engine;
pub mod fixed;
pub mod indicators;
pub mod intent;
pub mod record;
pub mod ruletree;
pub mod score;
pub mod synth;

pub use fixed::Fx;
