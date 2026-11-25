import { connectionName } from "./xpc.js";
import { type BlockHandler, releaseSnapshot, type RetainedConnection, snapshotHeap } from "./xpc-heap.js";
import type { XpcLayout } from "./xpc-layout.js";

export interface ExistingTraffic {
    connections: ExistingConnection[];
    pendingReplies: BlockHandler[];
    pauseMs: number;
}

export interface ExistingConnection {
    connection: NativePointer;
    name: string | null;
    isPeer: boolean;
    eventHandler: BlockHandler | null;
}

export function findExistingTraffic(layout: XpcLayout): ExistingTraffic {
    const snapshot = snapshotHeap(layout);
    const live = new Set(snapshot.connections.map(({ connection }) => connection.toString()));
    const connections = snapshot.connections.map(connection => describeConnection(connection, layout, live));
    releaseSnapshot(snapshot);
    return {
        connections,
        pendingReplies: snapshot.pendingReplies,
        pauseMs: snapshot.pauseMs,
    };
}

function describeConnection({ connection, eventHandler }: RetainedConnection, layout: XpcLayout, live: Set<string>): ExistingConnection {
    const listener = connection.add(layout.listenerOffset).readPointer().strip();
    const isPeer = live.has(listener.toString());
    return {
        connection,
        name: connectionName((isPeer) ? listener : connection),
        isPeer,
        eventHandler,
    };
}
