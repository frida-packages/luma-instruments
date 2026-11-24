Class {
	#name : 'VertexStream',
	#superclass : 'Object',
	#instVars : [
		'bytes',
		'used'
	],
	#category : 'GStreamer'
}

{ #category : 'initialization' }
VertexStream >> initialize [
	bytes := ByteArray new: 65536.
	used := 0
]

{ #category : 'writing' }
VertexStream >> add: aNumber [
	used + 4 > bytes size ifTrue: [ self grow ].
	bytes float32AtOffset: used put: aNumber asFloat.
	used := used + 4
]

{ #category : 'writing' }
VertexStream >> grow [
	bytes := (ByteArray new: bytes size * 2)
		replaceFrom: 1 to: used with: bytes startingAt: 1;
		yourself
]

{ #category : 'handing over' }
VertexStream >> drawOn: aDrawable [
	| held |
	used = 0 ifTrue: [ ^ aDrawable hide ].
	held := LumaBytes holding: (bytes copyFrom: 1 to: used).
	(aDrawable vertices: held primitive: #triangles) ifFalse: [ self error: LumaCanvas lastError ].
	held release.
	aDrawable show
]
