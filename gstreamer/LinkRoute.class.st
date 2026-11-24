Class {
	#name : 'LinkRoute',
	#superclass : 'Object',
	#instVars : [
		'start',
		'end',
		'heading',
		'points',
		'labels',
		'labelBox'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
LinkRoute class >> from: aStart through: someBends to: anEnd [
	^ self new setStart: aStart bends: someBends end: anEnd
]

{ #category : 'initialization' }
LinkRoute >> setStart: aStart bends: someBends end: anEnd [
	| leaving |
	start := aStart.
	end := anEnd - (self class arrowLength @ 0).
	heading := (someBends detect: [ :each | each left > (start x + 0.5) ] ifNone: [ nil ])
		ifNil: [ end ]
		ifNotNil: [ :bend | bend leftCenter ].
	points := OrderedCollection with: start.
	leaving := start.
	someBends do: [ :each |
		self curveFrom: leaving to: each leftCenter.
		points add: each rightCenter.
		leaving := each rightCenter ].
	(leaving x < end x or: [ leaving y ~= end y ]) ifTrue: [ self curveFrom: leaving to: end ].
	labels := #().
	labelBox := start extent: 0 @ 0
]

{ #category : 'initialization' }
LinkRoute >> curveFrom: aStart to: anEnd [
	| reach first second |
	reach := (anEnd x - aStart x) abs / 2 max: 8.
	first := (aStart x + reach) @ aStart y.
	second := (anEnd x - reach) @ anEnd y.
	1 to: 16 do: [ :each | points add: (self bezierAt: each / 16 from: aStart through: first and: second to: anEnd) ]
]

{ #category : 'initialization' }
LinkRoute >> bezierAt: aFraction from: aStart through: aFirst and: aSecond to: anEnd [
	| rest |
	rest := 1 - aFraction.
	^ (aStart * (rest * rest * rest)) + (aFirst * (3 * rest * rest * aFraction)) + (aSecond * (3 * rest * aFraction * aFraction)) + (anEnd * (aFraction * aFraction * aFraction))
]

{ #category : 'labelling' }
LinkRoute >> labelLines: someLines sizes: someSizes measuredBy: aLettering [
	| height top y |
	height := self heightOf: someLines sizes: someSizes measuredBy: aLettering.
	top := self rises
		ifTrue: [ start y + 2 ]
		ifFalse: [ start y - 2 - height ].
	y := top.
	labels := someLines collectWithIndex: [ :each :index |
		| size placed |
		size := someSizes at: (index min: 2).
		placed := { each. size. (start x + 5) @ y }.
		y := y + (aLettering lineHeight: size).
		placed ].
	labelBox := (start x + 5) @ top extent: (self widthOf: labels measuredBy: aLettering) @ height
]

{ #category : 'labelling' }
LinkRoute >> rises [
	^ heading y < (start y - 0.5)
]

{ #category : 'labelling' }
LinkRoute >> heightOf: someLines sizes: someSizes measuredBy: aLettering [
	^ (1 to: someLines size) inject: 0 into: [ :sum :each | sum + (aLettering lineHeight: (someSizes at: (each min: 2))) ]
]

{ #category : 'labelling' }
LinkRoute >> widthOf: someLabels measuredBy: aLettering [
	^ someLabels inject: 0 into: [ :widest :each | widest max: (aLettering widthOf: each first size: each second) ]
]

{ #category : 'picking' }
LinkRoute >> passesNear: aPoint within: aDistance [
	(labelBox containsPoint: aPoint) ifTrue: [ ^ true ].
	^ (1 to: points size - 1) anySatisfy: [ :each | (self distanceFrom: aPoint toSegment: each) <= aDistance ]
]

{ #category : 'picking' }
LinkRoute >> distanceFrom: aPoint toSegment: anIndex [
	| a b along span |
	a := points at: anIndex.
	b := points at: anIndex + 1.
	span := b - a.
	along := span dotProduct: span.
	along = 0 ifTrue: [ ^ aPoint distanceTo: a ].
	^ aPoint distanceTo: a + (span * ((((aPoint - a) dotProduct: span) / along) min: 1 max: 0))
]

{ #category : 'accessing' }
LinkRoute class >> arrowLength [
	^ 6
]

{ #category : 'accessing' }
LinkRoute >> start [
	^ start
]

{ #category : 'accessing' }
LinkRoute >> end [
	^ end
]

{ #category : 'accessing' }
LinkRoute >> tip [
	^ end + (self class arrowLength @ 0)
]

{ #category : 'accessing' }
LinkRoute >> points [
	^ points
]

{ #category : 'accessing' }
LinkRoute >> labelBox [
	^ labelBox
]

{ #category : 'accessing' }
LinkRoute >> labels [
	^ labels
]
