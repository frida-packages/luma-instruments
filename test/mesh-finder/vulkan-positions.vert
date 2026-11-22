#version 450

layout(location = 0) in vec3 inNormal;
layout(location = 2) in vec3 inPos;
layout(push_constant) uniform Transform { mat4 mvp; } transform;
layout(location = 0) out vec3 v_color;

void main()
{
    gl_Position = transform.mvp * vec4(inPos, 1.0);
    v_color = inNormal * 0.5 + 0.5;
}
