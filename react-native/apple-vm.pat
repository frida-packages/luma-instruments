struct VmRegionSubmapInfo {
    s32 protection;
    s32 maxProtection;
    padding[12];
    u32 userTag;
    padding[24];
    u32 isSubmap;
    padding[32];
};
