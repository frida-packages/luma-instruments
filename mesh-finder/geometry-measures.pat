struct IndexRange {
    u32 min;
    u32 max;
    u64 used;
};

struct IndexProfile {
    u32 max;
    u32 distinct;
    u64 degenerate;
    double meanStep;
};

struct PositionSample {
    double unitLength;
    double zeros;
    double continuityLostSquared;
    u32 homogeneous;
    padding[4];
};

struct Bounds {
    float min[3];
    float max[3];
};
