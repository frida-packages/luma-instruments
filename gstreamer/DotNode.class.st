Class {
	#name : 'DotNode',
	#superclass : 'Object',
	#instVars : [
		'id',
		'attributes'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
DotNode class >> id: aString attributes: aDictionary [
	^ self new setId: aString attributes: aDictionary
]

{ #category : 'initialization' }
DotNode >> setId: aString attributes: aDictionary [
	id := aString.
	attributes := aDictionary
]

{ #category : 'accessing' }
DotNode >> id [
	^ id
]

{ #category : 'accessing' }
DotNode >> attributes [
	^ attributes
]
