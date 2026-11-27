#version 450

layout(set = 0, binding = 0) uniform sampler2D albedo;
layout(set = 0, binding = 1) uniform sampler2D normalMap;
layout(location = 0) in vec3 v_color;
layout(location = 1) in vec2 v_uv;
layout(location = 0) out vec4 color;

void main()
{
    vec3 normal = texture(normalMap, v_uv).xyz * 2.0 - 1.0;
    color = texture(albedo, v_uv) * vec4(v_color * max(normal.z, 0.0), 1.0);
}
