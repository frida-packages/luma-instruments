Class {
	#name : 'PipelineSnapshot',
	#superclass : 'Object',
	#instVars : [
		'top',
		'elements',
		'pads',
		'links',
		'objects',
		'shape'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
PipelineSnapshot class >> top: aBin elements: someElements pads: somePads links: someLinks [
	^ self new setTop: aBin elements: someElements pads: somePads links: someLinks
]

{ #category : 'initialization' }
PipelineSnapshot >> setTop: aBin elements: someElements pads: somePads links: someLinks [
	top := aBin.
	elements := someElements.
	pads := somePads.
	links := someLinks.
	objects := Dictionary new.
	elements , pads , links do: [ :each | objects at: each key put: each ].
	shape := self describeShape
]

{ #category : 'initialization' }
PipelineSnapshot >> describeShape [
	^ String streamContents: [ :stream |
		elements do: [ :each | stream nextPutAll: each key; space; nextPutAll: each name; space; nextPutAll: each type; space; print: each depth; cr ].
		pads do: [ :each | stream nextPutAll: each key; space; nextPutAll: each name; space; nextPutAll: each element key; cr ].
		links do: [ :each | stream nextPutAll: each key; space; print: each labelLines; cr ] ]
]

{ #category : 'accessing' }
PipelineSnapshot >> objectKeyed: aKey [
	^ objects at: aKey ifAbsent: [ nil ]
]

{ #category : 'accessing' }
PipelineSnapshot >> top [
	^ top
]

{ #category : 'accessing' }
PipelineSnapshot >> elements [
	^ elements
]

{ #category : 'accessing' }
PipelineSnapshot >> pads [
	^ pads
]

{ #category : 'accessing' }
PipelineSnapshot >> links [
	^ links
]

{ #category : 'accessing' }
PipelineSnapshot >> shape [
	^ shape
]
