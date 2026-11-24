Class {
	#name : 'PipelineScene',
	#superclass : 'Object',
	#instVars : [
		'canvas',
		'palette',
		'boxes',
		'lines',
		'lettering',
		'marks',
		'markedLines',
		'strip',
		'caption',
		'captionText',
		'layout',
		'shapes',
		'strokes',
		'letters'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
PipelineScene class >> on: aCanvas [
	^ self new setCanvas: aCanvas
]

{ #category : 'initialization' }
PipelineScene >> setCanvas: aCanvas [
	canvas := aCanvas.
	palette := PipelinePalette new.
	boxes := self boxDrawable.
	lines := self lineDrawable.
	lettering := GraphLettering on: canvas addDrawable.
	self prepareGlyphs.
	marks := self boxDrawable.
	markedLines := self lineDrawable.
	strip := self stripDrawable.
	caption := LumaText on: canvas addDrawable pointSize: 11
]

{ #category : 'initialization' }
PipelineScene >> boxDrawable [
	^ self
		commit: canvas addDrawable
		declaring: [ :drawable |
			drawable
				attribute: 'p' components: 3;
				attribute: 'spot' components: 2;
				attribute: 'reach' components: 2;
				attribute: 'look' components: 4;
				varying: 'at' components: 2;
				varying: 'span' components: 2;
				varying: 'style' components: 4 ]
		vertex: 'void main() { at = spot; span = reach; style = look; gl_Position = vec4(toClip(p.xy), p.z, 1.0); }'
		fragment: self boxFragment
]

{ #category : 'initialization' }
PipelineScene >> commit: aDrawable declaring: aBlock vertex: aVertexBody fragment: aFragmentBody [
	aBlock value: aDrawable.
	aDrawable
		uniform: 'camera' value: #( 0 0 0 0 );
		uniform: 'frame' value: #( 0 0 1 1 );
		buffer: 'palette' values: palette values;
		vertexSource: self projection , aVertexBody fragmentSource: self toning , aFragmentBody.
	aDrawable commit ifFalse: [ self error: LumaCanvas lastError ].
	aDrawable hide.
	^ aDrawable
]

{ #category : 'shaders' }
PipelineScene >> projection [
	^ 'vec2 toClip(vec2 g) {
	vec2 view = u_resolution / max(u_scale, 1.0);
	vec2 extent = max(frame.zw - frame.xy, vec2(1.0));
	float fitted = min(min(view.x / extent.x, view.y / extent.y) * 0.95, 1.5);
	float zoom = camera.z > 0.0 ? camera.z : fitted;
	vec2 middle = camera.z > 0.0 ? camera.xy : (frame.xy + frame.zw) * 0.5;
	vec2 screen = (g - middle) * zoom;
	return vec2(screen.x * 2.0 / view.x, -screen.y * 2.0 / view.y);
}
'
]

{ #category : 'shaders' }
PipelineScene >> toning [
	^ 'vec3 tone(float t) {
	int k = int(t + 0.5) * 6 + (u_scheme > 0.5 ? 0 : 3);
	return vec3(paletteAt(k), paletteAt(k + 1), paletteAt(k + 2));
}
'
]

{ #category : 'shaders' }
PipelineScene >> boxFragment [
	^ 'float roundedBox(vec2 q, vec2 b, float r) {
	vec2 d = abs(q) - b + vec2(r);
	return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0) - r;
}
void main() {
	float d = roundedBox(at, span, style.w);
	float aa = max(fwidth(d), 0.0001);
	float rim = style.z > 2.5 ? 2.5 : 1.0;
	float inside = clamp(0.5 - d / aa, 0.0, 1.0);
	float core = clamp(0.5 - (d + rim) / aa, 0.0, 1.0);
	if (style.z > 0.5 && style.z < 2.5) {
		float along = abs(at.x) / span.x > abs(at.y) / span.y ? at.y : at.x;
		float period = style.z > 1.5 ? 2.5 : 6.0;
		if (fract(along / period) > 0.55) core = inside;
	}
	float filled = style.x > 0.5 ? 1.0 : 0.0;
	vec4 color = vec4(tone(style.y), 1.0) * (inside - core) + vec4(tone(style.x), 1.0) * filled * core;
	if (color.a < 0.004) discard;
	frag_color = color;
}
'
]

{ #category : 'initialization' }
PipelineScene >> lineDrawable [
	^ self
		commit: canvas addDrawable
		declaring: [ :drawable |
			drawable
				attribute: 'p' components: 3;
				attribute: 'ink' components: 1;
				varying: 'shade' components: 1 ]
		vertex: 'void main() { shade = ink; gl_Position = vec4(toClip(p.xy), p.z, 1.0); }'
		fragment: 'void main() { frag_color = vec4(tone(shade), 1.0); }'
]

{ #category : 'initialization' }
PipelineScene >> prepareGlyphs [
	self
		commit: lettering drawable
		declaring: [ :drawable |
			drawable
				attribute: 'p' components: 3;
				attribute: 'glyph' components: 2;
				attribute: 'ink' components: 1;
				varying: 'uv' components: 2;
				varying: 'shade' components: 1 ]
		vertex: 'void main() { uv = glyph; shade = ink; gl_Position = vec4(toClip(p.xy), p.z, 1.0); }'
		fragment: 'void main() {
	float a = texture(glyphs, uv).a;
	if (a < 0.02) discard;
	frag_color = vec4(tone(shade) * a, a);
}'
]

{ #category : 'initialization' }
PipelineScene >> stripDrawable [
	| drawable |
	drawable := canvas addDrawable.
	drawable
		attribute: 'corner' components: 2;
		vertexSource: 'void main() {
	vec2 view = u_resolution / max(u_scale, 1.0);
	gl_Position = vec4(corner.x, 1.0 - corner.y * ' , (self stripHeight * 2) printString , '.0 / view.y, 0.17, 1.0);
}'
		fragmentSource: 'void main() { frag_color = vec4(mix(vec3(0.075, 0.050, 0.065), vec3(0.994, 0.991, 0.986), u_scheme), 1.0); }'.
	(drawable mesh: #( -1 0 1 0 -1 1 1 0 1 1 -1 1 ) primitive: #triangles) ifFalse: [ self error: LumaCanvas lastError ].
	^ drawable
]

{ #category : 'drawing' }
PipelineScene >> draw: aSnapshot laidOut: aLayout [
	layout := aLayout.
	shapes := VertexStream new.
	strokes := VertexStream new.
	letters := VertexStream new.
	aSnapshot elements do: [ :each | self drawElement: each ].
	aSnapshot pads do: [ :each | self drawPad: each ].
	aSnapshot links do: [ :each | self drawLink: each ].
	(aSnapshot pads select: [ :each | each isGhost and: [ each partner notNil ] ]) do: [ :each | self drawConnectorOf: each ].
	shapes drawOn: boxes.
	strokes drawOn: lines.
	letters drawOn: lettering drawable.
	self uniform: 'frame' is: { aLayout bounds left. aLayout bounds top. aLayout bounds right. aLayout bounds bottom }
]

{ #category : 'drawing' }
PipelineScene >> drawElement: anElement [
	self
		box: (layout frameOf: anElement)
		depth: (self depthOfElement: anElement)
		fill: (self fillOf: anElement)
		edge: #border
		dash: 0
		radius: (anElement isBin ifTrue: [ 7 ] ifFalse: [ 4 ])
		into: shapes.
	self write: (layout headerOf: anElement) depth: 0.2
]

{ #category : 'drawing' }
PipelineScene >> depthOfElement: anElement [
	anElement isBin ifTrue: [ ^ 0.9 - (anElement depth * 0.02) ].
	^ 0.45
]

{ #category : 'drawing' }
PipelineScene >> box: aRectangle depth: aDepth fill: aFill edge: anEdge dash: aDash radius: aRadius into: aStream [
	| middle reach |
	middle := aRectangle center.
	reach := aRectangle extent / 2.
	#( #( -1 -1 ) #( 1 -1 ) #( -1 1 ) #( 1 -1 ) #( 1 1 ) #( -1 1 ) ) do: [ :corner |
		| spot |
		spot := (corner first @ corner last) * (reach + 1).
		aStream
			add: (middle + spot) x;
			add: (middle + spot) y;
			add: aDepth;
			add: spot x;
			add: spot y;
			add: reach x;
			add: reach y;
			add: (palette toneOf: aFill);
			add: (palette toneOf: anEdge);
			add: aDash;
			add: aRadius ]
]

{ #category : 'drawing' }
PipelineScene >> fillOf: anElement [
	anElement isBin ifTrue: [ ^ anElement depth even ifTrue: [ #bin ] ifFalse: [ #nestedBin ] ].
	^ anElement role asSymbol
]

{ #category : 'drawing' }
PipelineScene >> write: somePlacements depth: aDepth [
	somePlacements do: [ :each |
		lettering
			write: each first
			size: each second
			at: each third
			depth: aDepth
			tone: (palette toneOf: each fourth)
			into: letters ]
]

{ #category : 'drawing' }
PipelineScene >> drawPad: aPad [
	self
		box: (layout frameOf: aPad)
		depth: 0.4
		fill: (self fillOfPad: aPad)
		edge: #border
		dash: (self dashOf: aPad)
		radius: 2
		into: shapes.
	self write: (layout linesOfPad: aPad) depth: 0.2
]

{ #category : 'drawing' }
PipelineScene >> fillOfPad: aPad [
	aPad isProxy ifTrue: [ ^ self fillOfPad: aPad partner ].
	aPad isGhost ifTrue: [ ^ aPad isSource ifTrue: [ #ghostSourcePad ] ifFalse: [ #ghostSinkPad ] ].
	^ aPad isSource
		ifTrue: [ #sourcePad ]
		ifFalse: [ #sinkPad ]
]

{ #category : 'drawing' }
PipelineScene >> dashOf: aPad [
	aPad presence = 'request' ifTrue: [ ^ 1 ].
	aPad presence = 'sometimes' ifTrue: [ ^ 2 ].
	^ 0
]

{ #category : 'drawing' }
PipelineScene >> drawLink: aLink [
	| route |
	route := layout routeOf: aLink.
	self stroke: route points width: 1.1 depth: 0.5 tone: #link into: strokes.
	self arrowOf: route width: 1 depth: 0.44 tone: #link into: strokes.
	route labels ifNotEmpty: [ self plate: route labelBox behind: aLink ].
	route labels doWithIndex: [ :each :index |
		lettering
			write: each first
			size: each second
			at: each third
			depth: 0.2
			tone: (palette toneOf: (index = 1 ifTrue: [ #capsText ] ifFalse: [ #mutedText ]))
			into: letters ]
]

{ #category : 'drawing' }
PipelineScene >> plate: aRectangle behind: aLink [
	| fill |
	fill := self fillOf: (layout containerOf: aLink from).
	self
		box: (aRectangle expandBy: 1)
		depth: 0.48
		fill: fill
		edge: fill
		dash: 0
		radius: 1.5
		into: shapes
]

{ #category : 'drawing' }
PipelineScene >> stroke: somePoints width: aWidth depth: aDepth tone: aTone into: aStream [
	1 to: somePoints size - 1 do: [ :each | self segmentFrom: (somePoints at: each) to: (somePoints at: each + 1) width: aWidth depth: aDepth tone: aTone into: aStream ]
]

{ #category : 'drawing' }
PipelineScene >> segmentFrom: aStart to: anEnd width: aWidth depth: aDepth tone: aTone into: aStream [
	| along across |
	along := anEnd - aStart.
	along r = 0 ifTrue: [ ^ self ].
	across := (along y negated @ along x) * (aWidth / 2 / along r).
	self
		triangle: { aStart + across. aStart - across. anEnd + across } depth: aDepth tone: aTone into: aStream;
		triangle: { aStart - across. anEnd - across. anEnd + across } depth: aDepth tone: aTone into: aStream
]

{ #category : 'drawing' }
PipelineScene >> triangle: somePoints depth: aDepth tone: aTone into: aStream [
	somePoints do: [ :each |
		aStream
			add: each x;
			add: each y;
			add: aDepth;
			add: (palette toneOf: aTone) ]
]

{ #category : 'drawing' }
PipelineScene >> arrowOf: aRoute width: aScale depth: aDepth tone: aTone into: aStream [
	self
		triangle: {
			aRoute tip.
			aRoute end + (0 @ (aScale * 3.5)).
			aRoute end - (0 @ (aScale * 3.5)) }
		depth: aDepth
		tone: aTone
		into: aStream
]

{ #category : 'drawing' }
PipelineScene >> drawConnectorOf: aGhost [
	| ghost proxy from to |
	ghost := layout frameOf: aGhost.
	proxy := layout frameOf: aGhost partner.
	ghost center x < proxy center x
		ifTrue: [
			from := ghost rightCenter.
			to := proxy leftCenter ]
		ifFalse: [
			from := proxy rightCenter.
			to := ghost leftCenter ].
	self dashFrom: from to: to
]

{ #category : 'drawing' }
PipelineScene >> dashFrom: aStart to: anEnd [
	| length steps |
	length := (anEnd - aStart) r.
	steps := (length / 3) floor max: 1.
	0 to: steps - 1 by: 2 do: [ :each |
		self
			segmentFrom: aStart + ((anEnd - aStart) * (each / steps))
			to: aStart + ((anEnd - aStart) * ((each + 1) / steps))
			width: 1
			depth: 0.5
			tone: #link
			into: strokes ]
]

{ #category : 'drawing' }
PipelineScene >> uniform: aName is: aValue [
	{ boxes. lines. lettering drawable. marks. markedLines } do: [ :each | each uniform: aName value: aValue ]
]

{ #category : 'highlighting' }
PipelineScene >> mark: someObjects [
	| outlines thick |
	outlines := VertexStream new.
	thick := VertexStream new.
	someObjects do: [ :each | self mark: each outlines: outlines strokes: thick ].
	outlines drawOn: marks.
	thick drawOn: markedLines
]

{ #category : 'highlighting' }
PipelineScene >> mark: anObject outlines: someOutlines strokes: someStrokes [
	| route |
	(anObject isKindOf: PipelineLink) ifFalse: [
		^ self
			box: ((layout frameOf: anObject) expandBy: 1.5)
			depth: (self depthOfMark: anObject)
			fill: #none
			edge: #highlight
			dash: 3
			radius: 4
			into: someOutlines ].
	route := layout routeOf: anObject.
	self stroke: route points width: 2.6 depth: 0.42 tone: #highlight into: someStrokes.
	self arrowOf: route width: 1.6 depth: 0.42 tone: #highlight into: someStrokes
]

{ #category : 'highlighting' }
PipelineScene >> depthOfMark: anObject [
	(anObject isKindOf: PipelinePad) ifTrue: [ ^ 0.3 ].
	^ 0.43
]

{ #category : 'aiming' }
PipelineScene >> aim: aCamera [
	self uniform: 'camera' is: aCamera uniform
]

{ #category : 'captioning' }
PipelineScene >> caption: aString [
	captionText := aString.
	caption
		pad: #( 10 8 ) tint: self captionTint;
		show: aString
]

{ #category : 'captioning' }
PipelineScene >> captionTint [
	^ #( 0.5 0.53 0.6 )
]

{ #category : 'captioning' }
PipelineScene >> captionContains: aScreenPoint [
	^ aScreenPoint y < self stripHeight and: [ aScreenPoint x between: 10 and: 10 + (caption widthOf: captionText) ]
]

{ #category : 'captioning' }
PipelineScene >> hoverCaption: aBoolean [
	caption pad: #( 10 8 ) tint: (aBoolean
		ifTrue: [ #( 0.25 0.52 0.96 ) ]
		ifFalse: [ self captionTint ])
]

{ #category : 'captioning' }
PipelineScene >> stripHeight [
	^ 30
]

{ #category : 'clearing' }
PipelineScene >> clear [
	{ boxes. lines. lettering drawable. marks. markedLines } do: [ :each | each hide ]
]

{ #category : 'accessing' }
PipelineScene >> lettering [
	^ lettering
]

{ #category : 'accessing' }
PipelineScene >> handle [
	^ canvas handle
]
