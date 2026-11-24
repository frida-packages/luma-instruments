import { PayloadCapture } from "./payload-capture.js";
import { watchTlsLibraries } from "./tls-libraries.js";
import { TlsTraffic } from "./tls-traffic.js";
import { TrafficView } from "./traffic-view.js";

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const view = new TrafficView(ctx);
        const capture = new PayloadCapture(ctx, view, config.settings);
        const libraries = watchTlsLibraries(new TlsTraffic(view, capture));

        return {
            updateConfig(next) {
                capture.configure(next.settings);
            },
            onAction({ widget }) {
                switch (widget) {
                    case "sent":
                        view.clearSent();
                        break;
                    case "received":
                        view.clearReceived();
                        break;
                    case "connections":
                        view.clearConnections();
                        break;
                }
            },
            dispose() {
                libraries.dispose();
                view.dispose();
            },
        };
    },
};
