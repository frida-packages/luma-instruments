import { type Census, takeCensus } from "./census.js";
import { evaluate, type Outcome } from "./evaluation.js";
import type { LuaApi } from "./lua-api.js";
import type { ReadLimits } from "./lua-values.js";

export interface LuaExecutor {
    evaluate(L: NativePointer, source: string, limits: ReadLimits): Outcome;
    census(L: NativePointer): Census | null;
}

export class ApiExecutor implements LuaExecutor {
    readonly #api: LuaApi;

    constructor(api: LuaApi) {
        this.#api = api;
    }

    evaluate(L: NativePointer, source: string, limits: ReadLimits): Outcome {
        return evaluate(this.#api, L, source, limits);
    }

    census(L: NativePointer): Census | null {
        return takeCensus(this.#api, L);
    }
}
