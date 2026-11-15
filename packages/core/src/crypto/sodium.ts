/**
 * libsodium, loaded once. Awaiting it here means every function in this
 * library is synchronous and cannot be called before the library is ready.
 */
import sodium from "libsodium-wrappers"

await sodium.ready

export { sodium }
