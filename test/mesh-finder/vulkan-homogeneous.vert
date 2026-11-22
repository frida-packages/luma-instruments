#version 450

layout(location = 0) in vec4 a_position;
layout(push_constant) uniform Transform { mat4 mvp; } transform;
layout(location = 0) out vec3 v_color;

void main()
{
    gl_Position = transform.mvp * vec4(a_position.xyz, 1.0);
    v_color = vec3(1.0);
}
