import { ChannelLog } from "./channel-log.js";
import { ChannelPages } from "./channel-pages.js";
import { ChannelTable } from "./channel-table.js";
import { ConsoleCommands } from "./console-commands.js";
import { FactsTable } from "./facts-table.js";
import { FilesTable } from "./files-table.js";
import { offerFile } from "./flutter-files.js";
import { FlutterInspection } from "./flutter-inspection.js";
import { MessageTable } from "./message-table.js";
import { Settings } from "./settings.js";
import { StatusLine } from "./status-line.js";
import { TrafficView } from "./traffic-view.js";

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const settings = new Settings(config);
        const consoleWidget = ctx.widget("console");
        const status = new StatusLine(ctx.widget("status"));
        const facts = new FactsTable(ctx.widget("facts"));
        const files = new FilesTable(ctx.widget("files"));
        const log = new ChannelLog(settings);
        const messages = new MessageTable(ctx.widget("messages"), true);
        const channels = new ChannelTable(ctx.widget("channels"));
        const pages = new ChannelPages(ctx.children("channel"), log);
        log.observe(new TrafficView(ctx, settings, log, { messages, channels, pages, status }));
        const inspection = new FlutterInspection(settings, log);
        inspection.observe({
            onFindings(findings) {
                facts.show(findings, log.totals.engines);
                files.show(findings.files);
                status.showFindings(findings);
            },
            onProblem(problem) {
                status.showProblem(problem);
            },
        });
        let enginesShown = 0;
        log.observe({
            onChannelChanged() {
                const { engines } = log.totals;
                if (engines !== enginesShown && inspection.findings !== null) {
                    enginesShown = engines;
                    facts.show(inspection.findings, engines);
                }
            },
            onMessage() {
            },
            onReply() {
            },
        });
        const commands = new ConsoleCommands(log, inspection, files);
        const pageReply = {
            output: (text: string) => consoleWidget.appendOutput(text),
            error: (text: string) => consoleWidget.appendError(text),
            value: (value: unknown) => consoleWidget.appendValue(value),
        };
        inspection.start();

        return {
            updateConfig(next) {
                settings.apply(next);
            },
            onAction(action, respond) {
                if (action.child !== undefined) {
                    const page = pages.pageOf(action.child.id)!;
                    if (action.widget === "messages" && action.action === "inspect") {
                        const decoded = page.widget("console");
                        commands.inspect(Number(action.item), {
                            output: text => decoded.appendOutput(text),
                            error: text => decoded.appendError(text),
                            value: value => decoded.appendValue(value),
                            file: respond.file,
                        });
                    } else if (action.widget === "messages") {
                        pages.clear(action.child.id);
                    } else {
                        page.widget("console").clear();
                    }
                    return;
                }
                switch (action.widget) {
                    case "facts":
                        inspection.refresh();
                        break;
                    case "files":
                        offerFile(files.find(action.item)!, { ...pageReply, file: respond.file });
                        break;
                    case "channels":
                        respond.show(pages.show(log.channel(action.item)!));
                        break;
                    case "messages":
                        if (action.action === "inspect") {
                            commands.inspect(Number(action.item), { ...pageReply, file: respond.file });
                        } else {
                            messages.clear();
                        }
                        break;
                    case "console":
                        consoleWidget.clear();
                        break;
                }
            },
            onConsoleInput({ child, text }, respond) {
                if (child !== undefined && !/^\s*(inspect|help)\b/.test(text)) {
                    respond.error("This console decodes this channel's messages: inspect N.");
                    return;
                }
                commands.run(text, respond);
            },
            dispose() {
                inspection.dispose();
                messages.dispose();
                channels.dispose();
                pages.dispose();
                status.dispose();
            },
        };
    },
};
