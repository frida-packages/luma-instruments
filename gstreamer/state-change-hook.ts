import type { GStreamerApi } from "./gstreamer-api.js";

export type RootListener = (root: NativePointer) => void;

export class StateChangeHook {
    readonly #listener: InvocationListener;

    constructor(api: GStreamerApi, onRootChanging: RootListener) {
        this.#listener = Interceptor.attach(api.setStateAddress, {
            onEnter(args) {
                api.withRootOf(args[0], root => {
                    if (api.isBin(root)) {
                        onRootChanging(root);
                    }
                });
            },
        });
    }

    dispose(): void {
        this.#listener.detach();
        Interceptor.flush();
    }
}
