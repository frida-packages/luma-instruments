Class {
	#name : 'DotEdge',
	#superclass : 'Object',
	#instVars : [
		'tail',
		'head',
		'attributes'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
DotEdge class >> from: aTail to: aHead attributes: aDictionary [
	^ self new setTail: aTail head: aHead attributes: aDictionary
]

{ #category : 'initialization' }
DotEdge >> setTail: aTail head: aHead attributes: aDictionary [
	tail := aTail.
	head := aHead.
	attributes := aDictionary
]

{ #category : 'accessing' }
DotEdge >> tail [
	^ tail
]

{ #category : 'accessing' }
DotEdge >> head [
	^ head
]

{ #category : 'accessing' }
DotEdge >> attributes [
	^ attributes
]

{ #category : 'accessing' }
DotEdge >> style [
	^ attributes at: 'style' ifAbsent: [ '' ]
]
