struct SnapshotHeader {
    u32 magic;
    u64 length;
    u64 kind;
    char hash[32];
};
