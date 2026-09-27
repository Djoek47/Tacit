/**
 * aiuic-adapters — a project a developer already has becomes something people
 * talk to, without rewriting it.
 *
 *   fromOpenAPI    the backend's own document: paths become acts, GETs become
 *                  sources the aggregator can read
 *   fromFunctions  the functions the project already exports
 *
 * Both end at `ActDef`, which is where the MCP bridge ends too, so everything
 * downstream — the hold, the blast radius, the menus, the stage — is the same
 * code whatever the app was written in. None of these adapters can commit.
 */
export * from './openapi.js';
export * from './functions.js';
