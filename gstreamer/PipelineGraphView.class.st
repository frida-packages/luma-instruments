Class {
	#name : 'PipelineGraphView',
	#superclass : 'Object',
	#instVars : [
		'context',
		'scene',
		'camera',
		'pipeline',
		'details',
		'takenAt',
		'dotBytes',
		'snapshot',
		'layout',
		'selection',
		'pressedAt',
		'pointerAt',
		'dragged'
	],
	#category : 'GStreamer'
}

{ #category : 'opening' }
PipelineGraphView >> openIn: aContext [
	context := aContext.
	scene := PipelineScene on: aContext canvas.
	camera := GraphCamera new
]

{ #category : 'receiving' }
PipelineGraphView >> state: aValue data: someBytes [
	aValue ifNil: [ ^ self forget ].
	self follow: (aValue at: 'pipeline').
	details := aValue at: 'details'.
	takenAt := aValue at: 'takenAt'.
	self read: someBytes.
	self caption.
	context changed
]

{ #category : 'receiving' }
PipelineGraphView >> forget [
	pipeline := nil.
	dotBytes := nil.
	snapshot := nil.
	layout := nil.
	selection := nil.
	scene clear.
	scene caption: 'Waiting for the instrument to take a pipeline graph'.
	context changed
]

{ #category : 'receiving' }
PipelineGraphView >> follow: aPipeline [
	(pipeline isNil or: [ (pipeline at: 'id') ~= (aPipeline at: 'id') ]) ifTrue: [ camera fit ].
	pipeline := aPipeline
]

{ #category : 'receiving' }
PipelineGraphView >> read: someBytes [
	| bytes dot |
	bytes := someBytes asByteArray.
	someBytes release.
	bytes = dotBytes ifTrue: [ ^ scene aim: camera ].
	dotBytes := bytes.
	dot := bytes utf8Decoded.
	self show: (PipelineReader read: (DotParser parse: dot) dot: dot address: (pipeline at: 'id'))
]

{ #category : 'receiving' }
PipelineGraphView >> show: aSnapshot [
	(layout notNil and: [ layout shape = aSnapshot shape ]) ifFalse: [ layout := PipelineLayout of: aSnapshot measuredBy: scene lettering ].
	snapshot := aSnapshot.
	selection := selection ifNotNil: [ :chosen | snapshot objectKeyed: chosen key ].
	camera bounds: layout bounds.
	scene draw: snapshot laidOut: layout.
	scene aim: camera.
	self mark
]

{ #category : 'selecting' }
PipelineGraphView >> mark [
	scene mark: (selection
		ifNil: [ #() ]
		ifNotNil: [ :chosen | chosen linkedObjects ])
]

{ #category : 'captioning' }
PipelineGraphView >> caption [
	scene caption: (pipeline at: 'name') , '  ' , (pipeline at: 'type') , '  ' , (pipeline at: 'state') , '  details: ' , details , '  taken ' , self takenText
]

{ #category : 'captioning' }
PipelineGraphView >> takenText [
	^ (DateAndTime fromUnixTime: takenAt // 1000) asLocal asTime print24
]

{ #category : 'receiving' }
PipelineGraphView >> input: anEvent [
	snapshot ifNil: [ ^ self ].
	anEvent kind = #down ifTrue: [ ^ self press: anEvent ].
	anEvent kind = #move ifTrue: [ ^ self move: anEvent ].
	anEvent kind = #leave ifTrue: [ ^ scene hoverCaption: false ].
	anEvent kind = #up ifTrue: [ ^ self lift: anEvent ].
	anEvent kind = #scroll ifTrue: [ ^ self pan: anEvent dx @ anEvent dy in: anEvent ].
	anEvent kind = #zoom ifTrue: [ ^ self zoom: anEvent ].
	(anEvent kind = #keyDown and: [ anEvent key = $f asInteger ]) ifTrue: [ ^ self fit ]
]

{ #category : 'steering' }
PipelineGraphView >> press: anEvent [
	pressedAt := self screenPointOf: anEvent.
	pointerAt := pressedAt.
	dragged := false
]

{ #category : 'steering' }
PipelineGraphView >> screenPointOf: anEvent [
	^ ((anEvent x + 1) / 2 * anEvent width) @ ((1 - anEvent y) / 2 * anEvent height)
]

{ #category : 'steering' }
PipelineGraphView >> move: anEvent [
	anEvent buttons = 0 ifTrue: [ ^ scene hoverCaption: (scene captionContains: (self screenPointOf: anEvent)) ].
	pressedAt ifNotNil: [ self drag: anEvent ]
]

{ #category : 'steering' }
PipelineGraphView >> drag: anEvent [
	| now |
	now := self screenPointOf: anEvent.
	(now distanceTo: pressedAt) > 3 ifTrue: [ dragged := true ].
	self pan: now - pointerAt in: anEvent.
	pointerAt := now
]

{ #category : 'steering' }
PipelineGraphView >> pan: aDelta in: anEvent [
	camera pan: aDelta in: (self extentOf: anEvent).
	scene aim: camera
]

{ #category : 'steering' }
PipelineGraphView >> extentOf: anEvent [
	^ anEvent width @ anEvent height
]

{ #category : 'steering' }
PipelineGraphView >> lift: anEvent [
	pressedAt ifNil: [ ^ self ].
	dragged ifFalse: [ self clickAt: (self screenPointOf: anEvent) in: (self extentOf: anEvent) ].
	pressedAt := nil
]

{ #category : 'selecting' }
PipelineGraphView >> clickAt: aScreenPoint in: anExtent [
	selection := self objectAt: aScreenPoint in: anExtent.
	self mark.
	selection ifNotNil: [ :chosen | context spawn: chosen ]
]

{ #category : 'selecting' }
PipelineGraphView >> objectAt: aScreenPoint in: anExtent [
	(scene captionContains: aScreenPoint) ifTrue: [ ^ snapshot top ].
	^ (layout keyAt: (camera graphPointAt: aScreenPoint in: anExtent) within: (camera toleranceIn: anExtent))
		ifNotNil: [ :key | snapshot objectKeyed: key ]
]

{ #category : 'steering' }
PipelineGraphView >> zoom: anEvent [
	camera zoom: anEvent factor at: (self screenPointOf: anEvent) in: (self extentOf: anEvent).
	scene aim: camera
]

{ #category : 'steering' }
PipelineGraphView >> fit [
	camera fit.
	scene aim: camera
]

{ #category : 'views' }
PipelineGraphView >> gtGraphFor: aView [
	<gtView>
	^ aView canvas
		title: 'Graph';
		priority: 1;
		scene: [ scene handle ]
]
