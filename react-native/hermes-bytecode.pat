struct HermesBytecodeHeader {
    u64 magic;
    u32 version;
    u8 sourceHash[20];
    u32 fileLength;
    u32 globalCodeIndex;
    u32 functionCount;
};
