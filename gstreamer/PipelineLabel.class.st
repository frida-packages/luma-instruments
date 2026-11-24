Class {
	#name : 'PipelineLabel',
	#superclass : 'Object',
	#instVars : [
		'lines'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
PipelineLabel class >> of: aString [
	^ self new setLines: aString
]

{ #category : 'initialization' }
PipelineLabel >> setLines: aString [
	lines := ((self unescaped: aString) splitOn: Character lf) collect: [ :each | each splitOn: Character cr ]
]

{ #category : 'decoding' }
PipelineLabel >> unescaped: aString [
	| input |
	input := aString readStream.
	^ String new: aString size streamContents: [ :output |
		[ input atEnd ] whileFalse: [ output nextPut: (self decodedFrom: input) ] ]
]

{ #category : 'decoding' }
PipelineLabel >> decodedFrom: aStream [
	| character |
	character := aStream next.
	character = $\ ifFalse: [ ^ character ].
	^ self escaped: aStream next
]

{ #category : 'decoding' }
PipelineLabel >> escaped: aCharacter [
	('nlr' includes: aCharacter) ifTrue: [ ^ Character cr ].
	^ aCharacter
]

{ #category : 'reading' }
PipelineLabel >> fields [
	^ lines first
]

{ #category : 'reading' }
PipelineLabel >> properties [
	^ lines allButFirst collect: [ :each | (each first copyUpTo: $=) -> (each first copyAfter: $=) ]
]

{ #category : 'reading' }
PipelineLabel >> trailingField [
	^ lines last size > 1
		ifTrue: [ lines last last ]
		ifFalse: [ nil ]
]

{ #category : 'reading' }
PipelineLabel >> capsLines [
	^ (self fields collect: [ :each | each trimBoth ]) reject: [ :each | each isEmpty ]
]
