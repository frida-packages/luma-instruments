import re
import sys

OPEN = re.compile(r'^\s*subgraph (cluster_\S+) \{$')
PAD = re.compile(r'^\s*(\S+) \[color=black, fillcolor="(#\w+)", label="([^"\n]*)')
EDGE = re.compile(r"^\s*(\w+) -> (\w+)(.*)$")
LABEL = re.compile(r'^\s*label="([^"\n]*)')
GHOST_COLORS = {"#ffdddd", "#ddddff", "#ffffff"}


def first_field(text):
    return re.split(r"\\[nl]", text)[0].strip()


def attribute(rest, key):
    match = re.search(r'(?:^|[ \[,])' + key + r'="([^"]*)"', rest)
    return match.group(1) if match else ""


def media_type(rest):
    label = attribute(rest, "label")
    if label.strip():
        return first_field(label)
    tail = attribute(rest, "taillabel")
    head = attribute(rest, "headlabel")
    if head:
        return first_field(tail) + " / " + first_field(head)
    return ""


def read(path):
    stack = []
    element_of_cluster = {}
    pads = {}
    links = []
    elements = 0
    bins = set()
    awaiting_label = None
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        opened = OPEN.match(line)
        if opened:
            cluster = opened.group(1)
            is_pad_cluster = cluster.endswith("_sink") or cluster.endswith("_src")
            if not is_pad_cluster:
                elements += 1
                awaiting_label = cluster
                parent = next((c for c in reversed(stack) if c in element_of_cluster), None)
                if parent:
                    bins.add(parent)
            stack.append(cluster)
            continue
        if line.strip() == "}" and stack:
            stack.pop()
            continue
        if awaiting_label:
            labeled = LABEL.match(line)
            if labeled:
                element_of_cluster[awaiting_label] = re.split(r"\\n", labeled.group(1))[1]
                awaiting_label = None
                continue
        pad = PAD.match(line)
        if pad:
            node, color, label = pad.groups()
            owner = next(c for c in reversed(stack) if c in element_of_cluster)
            pads[node] = (element_of_cluster[owner], first_field(label), node.startswith("_"), color in GHOST_COLORS and not node.startswith("_"))
            continue
        edge = EDGE.match(line)
        if edge and "style=" not in edge.group(3):
            links.append((edge.group(1), edge.group(2), media_type(edge.group(3))))
    plain = [p for p in pads.values() if not p[2]]
    print("elements %d bins %d pads %d proxies %d ghosts %d links %d" % (
        elements, len(bins), len(plain), len(pads) - len(plain), sum(1 for p in pads.values() if p[3]), len(links)))
    lines = []
    for tail, head, media in links:
        lines.append("link %s.%s -> %s.%s [%s]" % (pads[tail][0], pads[tail][1], pads[head][0], pads[head][1], media))
    for each in sorted(lines):
        print(each)


read(sys.argv[1])
