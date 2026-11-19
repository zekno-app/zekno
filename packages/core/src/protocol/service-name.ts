/**
 * The name of one service of an app, as Docker Compose reports it. In a module
 * of its own, so that the rules of routes and health checks, the stored state
 * and the messages can all use it without importing one another.
 */
export const SERVICE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/
