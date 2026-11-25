import type { ExistingTraffic } from "./existing-traffic.js";
import { Recorder } from "./recorder.js";
import { ServiceBoard } from "./services.js";
import { Settings } from "./settings.js";
import { XpcTap } from "./traffic.js";

export const instrument: CustomInstrument = {
    create(ctx, config, restored) {
        const settings = new Settings(config);
        const services = new ServiceBoard(ctx.widget("services"), restored.services);
        const recorder = new Recorder(ctx, settings, services);
        const tap = new XpcTap(settings, capture => recorder.record(capture));
        announce(ctx.widget("messages"), tap.start());

        return {
            updateConfig(next) {
                settings.apply(next);
            },
            onAction({ widget }) {
                if (widget === "services") {
                    services.clear();
                } else {
                    recorder.clearLog();
                }
            },
            onConsoleInput({ text }, respond) {
                const number = text.replace(/^#/, "");
                const event = recorder.recall(Number(number));
                if (event !== undefined) {
                    respond.value(event);
                } else {
                    respond.error(`Message #${number} is not among the most recent ones.`);
                }
            },
            dispose() {
                tap.stop();
                recorder.discard();
            }
        };
    }
};

function announce(log: CustomInstrumentWidgetMap["messages"], existing: ExistingTraffic | Error): void {
    if (existing instanceof Error) {
        log.appendError(`Watching only the connections set up from now on: ${existing.message}.`);
        return;
    }
    const connections = counted(existing.connections.length, "connection");
    const requests = counted(existing.pendingReplies.length, "request");
    log.appendOutput(`Watching ${connections} and ${requests} awaiting a reply that were already there; `
        + `finding them stopped the process for ${existing.pauseMs.toFixed(2)} ms.`);
}

function counted(count: number, noun: string): string {
    return `${count} ${noun}${(count === 1) ? "" : "s"}`;
}
