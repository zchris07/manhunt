/**
 * GLSL ES 3.0 shaders for the vision system.
 *
 * The visibility mask is a half-resolution RenderTexture with three channels:
 *   B = the viewer's own vision (flashlight cone + proximity circle), with distance falloff
 *   G = the viewer's 360-degree line of sight (binary, long range)
 *   R = light sources (campfires, lamps, running generators), with distance falloff
 * visible = max(B, R * G): you see your own cone, plus lit areas you have line of sight to.
 * See-through light (night vision goggles, the Hemp Battery) is drawn into both R (at 70%)
 * and G, so areas behind walls show up at 70% brightness.
 * Anything not visible is pitch black.
 */

/** Filter vertex shader that also outputs the fragment's screen-space UV for mask lookups. */
export const screenVertex = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vScreenUV;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform vec4 uGlobalFrame;
uniform vec2 uScreenSize;

vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
    vec2 screenPos = aPosition * uOutputFrame.zw + uOutputFrame.xy + uGlobalFrame.xy;
    vScreenUV = screenPos / uScreenSize;
}
`;

const maskLookup = /* glsl */ `
float visibilityAt(vec2 screenUV)
{
    vec4 m = texture(uMask, screenUV * uMaskScale);
    float los = smoothstep(0.25, 0.75, m.g);
    return clamp(max(m.b, m.r * los), 0.0, 1.0);
}

/** How brightly something with this visibility is lit (0 = black). */
float lightAt(float v)
{
    return clamp(v * 1.06, 0.0, 1.06);
}
`;

/**
 * Post-process for the world layer: full, vivid colour where you can see, fading into pure
 * black. Plus a light vignette, a whisper of grain and a damage flash.
 */
export const visionFragment = /* glsl */ `
precision highp float;
in vec2 vTextureCoord;
in vec2 vScreenUV;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uMask;
uniform vec2 uMaskScale;
uniform vec2 uScreenSize;
uniform float uTime;
uniform float uGrain;
uniform float uFlicker;
uniform float uDamage;
uniform float uSaturation;
uniform vec3 uTint;

${maskLookup}

float hash(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main(void)
{
    vec4 scene = texture(uTexture, vTextureCoord);
    float vis = visibilityAt(vScreenUV);

    // A touch more saturation for the comic-book palette.
    float lum = dot(scene.rgb, vec3(0.299, 0.587, 0.114));
    vec3 vivid = mix(vec3(lum), scene.rgb, uSaturation);
    vec3 col = vivid * uTint * lightAt(vis) * smoothstep(0.0, 0.14, vis);
    col *= uFlicker;

    vec2 d = vScreenUV - 0.5;
    d.x *= uScreenSize.x / uScreenSize.y;
    float vig = smoothstep(1.05, 0.35, length(d));
    col *= mix(0.55, 1.0, vig);
    col += vec3(0.55, 0.0, 0.05) * uDamage * (1.0 - vig * 0.6);

    float n = hash(vScreenUV * uScreenSize + fract(uTime * 7.31) * 311.0) - 0.5;
    col += n * uGrain * step(0.02, vis);

    finalColor = vec4(max(col, 0.0), 1.0);
}
`;

/**
 * Entity occlusion: dynamic entities are cut by a hard threshold of the mask, so they are
 * fully invisible outside vision even when physically close. Inside, they are lit like the
 * ground around them (70% brightness in see-through light).
 */
export const entityMaskFragment = /* glsl */ `
precision highp float;
in vec2 vTextureCoord;
in vec2 vScreenUV;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uMask;
uniform vec2 uMaskScale;
uniform vec2 uScreenSize;
uniform float uThreshold;

${maskLookup}

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);
    float vis = visibilityAt(vScreenUV);
    float k = min(1.0, lightAt(vis));
    finalColor = vec4(c.rgb * k, c.a) * step(uThreshold, vis);
}
`;
