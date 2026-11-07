import { hashSeed } from '../shared/rng.js';
/** Scaling scaffold, not enabled in V0.1. A master can route sticky room codes
 * to workers using this pure function; lobby discovery can be replaced by Redis.
 * @see docs/DESIGN.md for the IGameServer boundary.
 */
export function routeRoom(roomId, workers) { if (!workers.length) throw new Error('No game workers'); return workers[hashSeed(roomId) % workers.length]; }
export const IGameServerContract = Object.freeze(['createRoom','getRoom','listRooms','tick','shutdown']);
