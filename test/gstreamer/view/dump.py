import sys
import time

import gi

gi.require_version("Gst", "1.0")
from gi.repository import Gst

DETAILS = {
    "states": Gst.DebugGraphDetails.STATES,
    "all": Gst.DebugGraphDetails.ALL,
    "verbose": Gst.DebugGraphDetails.VERBOSE,
}


def main():
    Gst.init(None)
    description, prefix, settle = sys.argv[1], sys.argv[2], float(sys.argv[3])
    pipeline = Gst.parse_launch(description)
    dump(pipeline, prefix + "-null")
    pipeline.set_state(Gst.State.PAUSED)
    pipeline.get_state(5 * Gst.SECOND)
    pipeline.set_state(Gst.State.PLAYING)
    time.sleep(settle)
    dump(pipeline, prefix + "-playing")
    pipeline.set_state(Gst.State.NULL)


def dump(pipeline, stem):
    for name, details in DETAILS.items():
        with open(f"{stem}-{name}.dot", "w") as out:
            out.write(Gst.debug_bin_to_dot_data(pipeline, details))


main()
