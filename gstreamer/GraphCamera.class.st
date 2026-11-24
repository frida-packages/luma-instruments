Class {
	#name : 'GraphCamera',
	#superclass : 'Object',
	#instVars : [
		'bounds',
		'center',
		'zoom'
	],
	#category : 'GStreamer'
}

{ #category : 'framing' }
GraphCamera >> bounds: aRectangle [
	bounds := aRectangle
]

{ #category : 'framing' }
GraphCamera >> fit [
	center := nil.
	zoom := nil
]

{ #category : 'steering' }
GraphCamera >> pan: aDelta in: anExtent [
	self pinIn: anExtent.
	center := center - (aDelta / zoom)
]

{ #category : 'steering' }
GraphCamera >> pinIn: anExtent [
	center := self centerNow.
	zoom := self zoomIn: anExtent
]

{ #category : 'steering' }
GraphCamera >> centerNow [
	^ center ifNil: [ bounds center ]
]

{ #category : 'steering' }
GraphCamera >> zoomIn: anExtent [
	^ zoom ifNil: [ self fitZoomIn: anExtent ]
]

{ #category : 'steering' }
GraphCamera >> fitZoomIn: anExtent [
	^ ((anExtent x / bounds width) min: anExtent y / bounds height) * 0.95 min: 1.5
]

{ #category : 'steering' }
GraphCamera >> zoom: aFactor at: aScreenPoint in: anExtent [
	| anchor |
	anchor := self graphPointAt: aScreenPoint in: anExtent.
	self pinIn: anExtent.
	zoom := zoom * aFactor min: 8 max: 0.05.
	center := anchor - ((aScreenPoint - (anExtent / 2)) / zoom)
]

{ #category : 'steering' }
GraphCamera >> graphPointAt: aScreenPoint in: anExtent [
	^ self centerNow + ((aScreenPoint - (anExtent / 2)) / (self zoomIn: anExtent))
]

{ #category : 'steering' }
GraphCamera >> toleranceIn: anExtent [
	^ 5 / (self zoomIn: anExtent)
]

{ #category : 'uniforms' }
GraphCamera >> uniform [
	^ zoom
		ifNil: [ #( 0 0 0 0 ) ]
		ifNotNil: [ { center x. center y. zoom. 0 } ]
]

{ #category : 'uniforms' }
GraphCamera >> boundsUniform [
	^ { bounds left. bounds top. bounds right. bounds bottom }
]
