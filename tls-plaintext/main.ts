import { PayloadCapture } from "./payload-capture.js";
import { watchTlsLibraries } from "./tls-libraries.js";
import { TlsTraffic } from "./tls-traffic.js";
import { TrafficView } from "./traffic-view.js";

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const view = new TrafficView(ctx);
        const capture = new PayloadCapture(ctx, view, config.features);
        const libraries = watchTlsLibraries(new TlsTraffic(view, capture));

        return {
            updateConfig(next) {
                capture.configure(next.features);
            },
            dispose() {
                libraries.dispose();
                view.dispose();
            },
        };
    },
};
