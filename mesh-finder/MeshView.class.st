Class {
	#name : 'MeshView',
	#superclass : 'Object',
	#instVars : [
		'context',
		'canvas',
		'surface',
		'wire',
		'points',
		'heading',
		'note',
		'buttons',
		'mode',
		'yaw',
		'pitch',
		'zoom',
		'center',
		'radius',
		'low',
		'high',
		'vertexCount',
		'triangleCount',
		'title',
		'remark',
		'facts',
		'dragStart',
		'dragFrom',
		'gesture'
	],
	#category : 'MeshDemo'
}

{ #category : 'opening' }
MeshView >> openIn: aContext [
	context := aContext.
	canvas := aContext canvas.
	surface := self drawableFragment: self surfaceFragment.
	wire := self drawableFragment: self wireFragment.
	points := self pointCloud.
	heading := LumaText on: canvas addDrawable pointSize: 13.
	note := LumaText on: canvas addDrawable pointSize: 11.
	buttons := self modes collect: [ :each | each -> (LumaText on: canvas addDrawable pointSize: 12) ].
	mode := #shaded.
	self reset.
	self forget
]

{ #category : 'receiving' }
MeshView >> state: aValue data: someBytes [
	aValue ifNil: [ ^ self forget ].
	vertexCount := aValue at: 'vertices'.
	triangleCount := aValue at: 'triangles' ifAbsent: [ 0 ].
	title := aValue at: 'title' ifAbsent: [ 'Mesh' ].
	remark := aValue at: 'unshown' ifAbsent: [ '' ].
	facts := (aValue at: 'details' ifAbsent: [ #() ]) collect: [ :each | each first -> each last ].
	vertexCount > 0 ifTrue: [ self take: someBytes ].
	self reset.
	self show
]

{ #category : 'receiving' }
MeshView >> event: aValue data: someBytes [
	remark := aValue at: 'say' ifAbsent: [ remark ].
	self showText
]

{ #category : 'receiving' }
MeshView >> input: anEvent [
	anEvent kind = #down ifTrue: [ ^ self press: anEvent ].
	anEvent kind = #move ifTrue: [ ^ self drag: anEvent ].
	anEvent kind = #up ifTrue: [ ^ self lift: anEvent ].
	anEvent kind = #scroll ifTrue: [ ^ self zoomBy: (anEvent dy * 0.01) exp ].
	anEvent kind = #zoom ifTrue: [ ^ self zoomBy: anEvent factor ].
	anEvent kind = #keyDown ifTrue: [ ^ self type: anEvent key ]
]

{ #category : 'views' }
MeshView >> gtMeshFor: aView [
	<gtView>
	^ aView canvas
		title: 'Mesh';
		priority: 1;
		scene: [ canvas handle ]
]

{ #category : 'views' }
MeshView >> gtDetailsFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Details';
		priority: 2;
		items: [ self details ];
		column: 'Property' do: [ :column |
			column
				text: [ :each | each key ];
				fitContent ];
		column: 'Value' text: [ :each | each value ]
]

{ #category : 'accessing' }
MeshView >> details [
	^ { 'Title' -> title. 'Vertices' -> vertexCount printString. 'Triangles' -> triangleCount printString } , facts , {
		'Mode' -> mode.
		'Zoom' -> (zoom printShowingDecimalPlaces: 2).
		'Remark' -> remark }
]

{ #category : 'building' }
MeshView >> drawableFragment: aFragmentSource [
	| drawable |
	drawable := canvas addDrawable.
	drawable
		attribute: 'position' components: 3;
		varying: 'seen' components: 3;
		uniform: 'modelView' value: (self translation: #(0 0 0));
		uniform: 'projection' value: (self translation: #(0 0 0));
		vertexSource: 'void main() {
			vec4 eye = modelView * vec4(position, 1.0);
			seen = eye.xyz;
			vec4 clip = projection * eye;
			clip.x *= u_resolution.y / u_resolution.x;
			gl_Position = clip;
		}'
		fragmentSource: aFragmentSource.
	drawable commit ifFalse: [ self error: LumaCanvas lastError ].
	drawable hide.
	^ drawable
]

{ #category : 'building' }
MeshView >> surfaceFragment [
	^ 'void main() {
		vec3 normal = normalize(cross(dFdx(seen), dFdy(seen)));
		float lit = 0.3 + 0.7 * abs(dot(normal, normalize(vec3(0.35, 0.55, 0.75))));
		vec3 tint = mix(vec3(0.55, 0.72, 0.95), vec3(0.16, 0.36, 0.66), u_scheme);
		frag_color = vec4(tint * lit, 1.0);
	}'
]

{ #category : 'building' }
MeshView >> wireFragment [
	^ 'void main() {
		frag_color = vec4(mix(vec3(0.6, 0.85, 1.0), vec3(0.1, 0.3, 0.6), u_scheme), 1.0);
	}'
]

{ #category : 'building' }
MeshView >> pointCloud [
	| drawable |
	drawable := canvas addDrawable.
	drawable
		attribute: 'position' components: 3;
		varying: 'rise' components: 1;
		uniform: 'modelView' value: (self translation: #(0 0 0));
		uniform: 'projection' value: (self translation: #(0 0 0));
		uniform: 'low' value: #(0 0 0);
		uniform: 'high' value: #(1 1 1);
		vertexSource: 'void main() {
			rise = clamp((position.y - low.y) / max(high.y - low.y, 0.000001), 0.0, 1.0);
			vec4 clip = projection * (modelView * vec4(position, 1.0));
			clip.x *= u_resolution.y / u_resolution.x;
			gl_Position = clip;
			gl_PointSize = 3.0 * u_scale;
		}'
		fragmentSource: 'void main() {
			vec2 at = gl_PointCoord - vec2(0.5);
			if (dot(at, at) > 0.25) discard;
			frag_color = vec4(mix(vec3(0.15, 0.45, 0.85), vec3(0.95, 0.55, 0.2), rise), 1.0);
		}'.
	drawable commit ifFalse: [ self error: LumaCanvas lastError ].
	drawable hide.
	^ drawable
]

{ #category : 'receiving' }
MeshView >> forget [
	vertexCount := 0.
	triangleCount := 0.
	title := 'Select a mesh in the table to see it here'.
	remark := ''.
	facts := #().
	self show
]

{ #category : 'receiving' }
MeshView >> take: someBytes [
	| positions indices |
	positions := someBytes from: 0 size: vertexCount * 12.
	self frame: (positions float32Extent: 3).
	points vertices: positions primitive: #points.
	triangleCount > 0 ifFalse: [ ^ mode := #points ].
	indices := someBytes from: vertexCount * 12 size: triangleCount * 12.
	(surface vertices: positions indices: indices primitive: #triangles) ifFalse: [ self error: LumaCanvas lastError ].
	(wire vertices: positions indices: indices primitive: #lines) ifFalse: [ self error: LumaCanvas lastError ].
	positions release.
	indices release.
	someBytes release.
	mode = #points ifTrue: [ mode := #shaded ]
]

{ #category : 'framing' }
MeshView >> frame: anExtent [
	anExtent ifNil: [ ^ self ].
	low := anExtent first.
	high := anExtent last.
	center := (1 to: 3) collect: [ :each | ((low at: each) + (high at: each)) / 2 ].
	radius := (((1 to: 3) inject: 0 into: [ :sum :each | sum + ((high at: each) - (low at: each)) squared ]) sqrt / 2) max: 1.0e-6
]

{ #category : 'framing' }
MeshView >> reset [
	yaw := 0.6.
	pitch := 0.45.
	zoom := 1.0
]

{ #category : 'steering' }
MeshView >> press: anEvent [
	dragStart := anEvent position.
	dragFrom := yaw @ pitch.
	gesture := #tap
]

{ #category : 'steering' }
MeshView >> drag: anEvent [
	| shift |
	(dragStart isNil or: [ anEvent buttons = 0 ]) ifTrue: [ ^ self ].
	shift := anEvent position - dragStart.
	shift r > 0.01 ifTrue: [ gesture := #drag ].
	yaw := dragFrom x + (shift x * Float pi).
	pitch := ((dragFrom y - (shift y * Float pi / 2)) max: -1.5) min: 1.5.
	self aim
]

{ #category : 'steering' }
MeshView >> lift: anEvent [
	dragStart ifNil: [ ^ self ].
	gesture = #tap ifTrue: [ (self buttonAt: anEvent) ifNotNil: [ :picked | self pick: picked ] ].
	dragStart := nil
]

{ #category : 'steering' }
MeshView >> zoomBy: aFactor [
	zoom := ((zoom * aFactor) max: 0.05) min: 50.
	self aim
]

{ #category : 'steering' }
MeshView >> type: aKey [
	aKey = $s asInteger ifTrue: [ ^ self pick: #shaded ].
	aKey = $w asInteger ifTrue: [ ^ self pick: #wire ].
	aKey = $p asInteger ifTrue: [ ^ self pick: #points ].
	aKey = $r asInteger ifTrue: [ ^ self pick: #reset ]
]

{ #category : 'steering' }
MeshView >> buttonAt: anEvent [
	| x y |
	x := (anEvent x + 1) / 2 * anEvent width.
	y := (1 - anEvent y) / 2 * anEvent height.
	(y between: self buttonTop and: self buttonTop + 18) ifFalse: [ ^ nil ].
	self buttonSpans do: [ :each | (x between: each value first and: each value last) ifTrue: [ ^ each key ] ].
	^ nil
]

{ #category : 'steering' }
MeshView >> pick: aMode [
	aMode = #reset ifTrue: [
		self reset.
		^ self show ].
	(triangleCount = 0 and: [ aMode ~= #points ]) ifTrue: [ ^ self ].
	mode := aMode.
	context send: { 'mode' -> mode } asDictionary.
	self show
]

{ #category : 'drawing' }
MeshView >> show [
	surface hide.
	wire hide.
	points hide.
	vertexCount > 0 ifTrue: [ (self drawableShowing: mode) show ].
	self aim.
	self showText
]

{ #category : 'drawing' }
MeshView >> drawableShowing: aMode [
	aMode = #wire ifTrue: [ ^ wire ].
	aMode = #points ifTrue: [ ^ points ].
	^ surface
]

{ #category : 'drawing' }
MeshView >> aim [
	| view lens |
	center ifNil: [ ^ self ].
	view := self orbit.
	lens := self lens.
	{ surface. wire. points } do: [ :each |
		each
			uniform: 'modelView' value: view;
			uniform: 'projection' value: lens ].
	points
		uniform: 'low' value: low;
		uniform: 'high' value: high
]

{ #category : 'drawing' }
MeshView >> orbit [
	^ self
		multiply: (self translation: { 0. 0. self distance negated })
		by: (self
			multiply: (self pitchedBy: pitch)
			by: (self
				multiply: (self yawedBy: yaw)
				by: (self translation: (center collect: [ :each | each negated ]))))
]

{ #category : 'drawing' }
MeshView >> lens [
	| focal near far |
	focal := 1.0 / (22.5 degreesToRadians tan).
	near := (self distance - (radius * 1.5)) max: self distance * 0.01.
	far := self distance + (radius * 1.5).
	^ {
		focal. 0. 0. 0.
		0. focal. 0. 0.
		0. 0. far / (near - far). -1.
		0. 0. near * far / (near - far). 0 }
]

{ #category : 'drawing' }
MeshView >> distance [
	^ radius * 2.8 / zoom
]

{ #category : 'drawing' }
MeshView >> showText [
	heading pad: #(12 10) tint: #(0.45 0.5 0.58); show: self headline.
	note pad: #(12 28) tint: #(0.94 0.39 0.34); show: remark.
	buttons do: [ :each | each value show: '' ].
	self buttonSpans do: [ :each |
		| label |
		label := buttons detect: [ :button | button key = each key ].
		label value
			pad: { each value first. self buttonTop }
			tint: (each key = mode ifTrue: [ #(0.94 0.39 0.34) ] ifFalse: [ #(0.45 0.5 0.58) ]);
			show: (self labelOf: each key) ]
]

{ #category : 'drawing' }
MeshView >> headline [
	vertexCount = 0 ifTrue: [ ^ title ].
	^ String streamContents: [ :stream |
		stream nextPutAll: title; nextPutAll: '   '; print: vertexCount; nextPutAll: ' vertices'.
		triangleCount > 0 ifTrue: [ stream nextPutAll: '   '; print: triangleCount; nextPutAll: ' triangles' ] ]
]

{ #category : 'drawing' }
MeshView >> buttonSpans [
	| x |
	x := 12.
	^ self availableModes collect: [ :each |
		| wide span |
		wide := (buttons detect: [ :button | button key = each ]) value widthOf: (self labelOf: each).
		span := each -> { x. x + wide }.
		x := x + wide + 14.
		span ]
]

{ #category : 'drawing' }
MeshView >> availableModes [
	triangleCount = 0 ifTrue: [ ^ #(points reset) ].
	^ self modes
]

{ #category : 'drawing' }
MeshView >> modes [
	^ #(shaded wire points reset)
]

{ #category : 'drawing' }
MeshView >> labelOf: aMode [
	^ aMode asString capitalized
]

{ #category : 'drawing' }
MeshView >> buttonTop [
	^ 46
]

{ #category : 'matrices' }
MeshView >> multiply: a by: b [
	^ (1 to: 16) collect: [ :each |
		| column row |
		column := each - 1 // 4.
		row := each - 1 \\ 4.
		(0 to: 3) inject: 0 into: [ :sum :k | sum + ((a at: k * 4 + row + 1) * (b at: column * 4 + k + 1)) ] ]
]

{ #category : 'matrices' }
MeshView >> translation: aVector [
	^ { 1. 0. 0. 0.  0. 1. 0. 0.  0. 0. 1. 0.  aVector first. aVector second. aVector third. 1 }
]

{ #category : 'matrices' }
MeshView >> pitchedBy: anAngle [
	| c s |
	c := anAngle cos.
	s := anAngle sin.
	^ { 1. 0. 0. 0.  0. c. s. 0.  0. s negated. c. 0.  0. 0. 0. 1 }
]

{ #category : 'matrices' }
MeshView >> yawedBy: anAngle [
	| c s |
	c := anAngle cos.
	s := anAngle sin.
	^ { c. 0. s negated. 0.  0. 1. 0. 0.  s. 0. c. 0.  0. 0. 0. 1 }
]
