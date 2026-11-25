struct HeapKinds {
    u8 *isaClassMask : u64;
    u8 *mallocBlockClass : u64;
    u8 *globalBlockClass : u64;
    u8 *retainWeakReference : u64;
    u8 *allocatorStart : u64;
    u8 *allocatorEnd : u64;
};

struct ObjectBatch {
    u8 *cls : u64;
    u8 *retain : u64;
    u64 handlerOffset;
    u8 *candidates : u64;
    u32 count;
    u32 retained;
    u8 *facts : u64;
};

struct ObjectFacts {
    u8 *object : u64;
    u8 *handler : u64;
    u8 *invoke : u64;
};

struct HeapSnapshotRequest {
    u8 *sparedThreads : u64;
    u32 sparedCount;
    u32 stoppedCapacity;
    u8 *stoppedThreads : u64;
    ObjectBatch connections;
    ObjectBatch serializers;
    u64 pausedFor;
};

struct Location {
    s64 offset;
    u64 size;
    u64 matches;
};
