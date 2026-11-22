export type Visitor = (state: NativePointer, threadId: ThreadId) => void;

export interface VisitFilter {
    attach(target: NativePointer): InvocationListener;
    admitEverything(): void;
    admitOnly(globalOffset: number, globals: NativePointer[], noticeAfter: number): void;
}

export interface VisitGate {
    filter(visitor: Visitor, onForeignVisits: () => void): VisitFilter;
}

type Admission = "everything" | "wanted";

const nativeModes: Record<Admission, number> = {
    everything: 0,
    wanted: 1,
};

const MAX_WANTED = 16;
const POINTER_SIZE = Process.pointerSize;
const MODE_OFFSET = 2 * POINTER_SIZE;
const GLOBAL_OFFSET_OFFSET = MODE_OFFSET + 4;
const WANTED_COUNT_OFFSET = GLOBAL_OFFSET_OFFSET + 4;
const REJECTED_OFFSET = WANTED_COUNT_OFFSET + 4;
const NOTICE_AFTER_OFFSET = REJECTED_OFFSET + 4;
const WANTED_OFFSET = Math.ceil((NOTICE_AFTER_OFFSET + 4) / POINTER_SIZE) * POINTER_SIZE;
const FILTER_SIZE = WANTED_OFFSET + MAX_WANTED * POINTER_SIZE;

const filterSource = `
#include <gum/guminterceptor.h>

typedef enum _FilterMode FilterMode;
typedef struct _Filter Filter;

enum _FilterMode
{
  FILTER_ADMIT_EVERYTHING,
  FILTER_ADMIT_WANTED,
};

struct _Filter
{
  void (* visit) (gpointer state);
  void (* notice) (void);
  gint mode;
  guint global_offset;
  guint wanted_count;
  guint rejected;
  guint notice_after;
  gpointer wanted[${MAX_WANTED}];
};

void
on_enter (GumInvocationContext * ic)
{
  Filter * filter = gum_invocation_context_get_listener_function_data (ic);
  gpointer state = gum_invocation_context_get_nth_argument (ic, 0);

  if (filter->mode == FILTER_ADMIT_WANTED)
  {
    gpointer global = *(gpointer *) ((guint8 *) state + filter->global_offset);
    guint count = filter->wanted_count;
    guint i;

    if (count > ${MAX_WANTED})
      count = ${MAX_WANTED};
    for (i = 0; i < count; i++)
    {
      if (filter->wanted[i] == global)
        break;
    }
    if (i == count)
    {
      if (++filter->rejected == filter->notice_after)
        filter->notice ();
      return;
    }
  }

  filter->visit (state);
}
`;

export function openVisitGate(): VisitGate {
    try {
        return new NativeVisitGate(new CModule(filterSource));
    } catch (e) {
        return new ScriptVisitGate();
    }
}

class NativeVisitGate implements VisitGate {
    constructor(private readonly module: CModule) {
    }

    filter(visitor: Visitor, onForeignVisits: () => void): VisitFilter {
        return new NativeVisitFilter(this.module.on_enter, visitor, onForeignVisits);
    }
}

class NativeVisitFilter implements VisitFilter {
    private readonly memory = Memory.alloc(FILTER_SIZE);
    private readonly visit: NativeCallback<"void", ["pointer"]>;
    private readonly notice: NativeCallback<"void", []>;

    constructor(private readonly onEnter: NativePointer, visitor: Visitor, onForeignVisits: () => void) {
        this.visit = new NativeCallback(state => visitor(state, Process.getCurrentThreadId()), "void", ["pointer"]);
        this.notice = new NativeCallback(onForeignVisits, "void", []);
        this.memory.writePointer(this.visit);
        this.memory.add(POINTER_SIZE).writePointer(this.notice);
        this.admitEverything();
    }

    attach(target: NativePointer): InvocationListener {
        return Interceptor.attach(target, { onEnter: this.onEnter }, this.memory);
    }

    admitEverything(): void {
        this.memory.add(MODE_OFFSET).writeS32(nativeModes.everything);
    }

    admitOnly(globalOffset: number, globals: NativePointer[], noticeAfter: number): void {
        if (globals.length > MAX_WANTED) {
            this.admitEverything();
            return;
        }
        const field = (offset: number) => this.memory.add(offset);
        field(WANTED_COUNT_OFFSET).writeU32(0);
        field(GLOBAL_OFFSET_OFFSET).writeU32(globalOffset);
        globals.forEach((global, index) => field(WANTED_OFFSET + index * POINTER_SIZE).writePointer(global));
        field(REJECTED_OFFSET).writeU32(0);
        field(NOTICE_AFTER_OFFSET).writeU32(noticeAfter);
        field(WANTED_COUNT_OFFSET).writeU32(globals.length);
        field(MODE_OFFSET).writeS32(nativeModes.wanted);
    }
}

class ScriptVisitGate implements VisitGate {
    filter(visitor: Visitor, onForeignVisits: () => void): VisitFilter {
        return new ScriptVisitFilter(visitor, onForeignVisits);
    }
}

class ScriptVisitFilter implements VisitFilter {
    private admission: Admission = "everything";
    private globalOffset = 0;
    private wanted = new Set<string>();
    private rejected = 0;
    private noticeAfter = 0;

    constructor(private readonly visitor: Visitor, private readonly onForeignVisits: () => void) {
    }

    attach(target: NativePointer): InvocationListener {
        const filter = this;
        return Interceptor.attach(target, {
            onEnter(args) {
                filter.consider(args[0], this.threadId);
            },
        });
    }

    admitEverything(): void {
        this.admission = "everything";
    }

    admitOnly(globalOffset: number, globals: NativePointer[], noticeAfter: number): void {
        this.globalOffset = globalOffset;
        this.wanted = new Set(globals.map(global => global.toString()));
        this.rejected = 0;
        this.noticeAfter = noticeAfter;
        this.admission = "wanted";
    }

    private consider(state: NativePointer, threadId: ThreadId): void {
        if (this.admission === "wanted" && !this.wanted.has(state.add(this.globalOffset).readPointer().toString())) {
            if (++this.rejected === this.noticeAfter) {
                this.onForeignVisits();
            }
            return;
        }
        this.visitor(state, threadId);
    }
}
