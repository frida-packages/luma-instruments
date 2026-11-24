Class {
	#name : 'DotScanner',
	#superclass : 'Object',
	#instVars : [
		'source',
		'position',
		'kind',
		'text'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
DotScanner class >> on: aString [
	^ self new setSource: aString
]

{ #category : 'initialization' }
DotScanner >> setSource: aString [
	source := aString.
	position := 1
]

{ #category : 'scanning' }
DotScanner >> advance [
	| character |
	self skipSeparators.
	position > source size ifTrue: [ ^ kind := #end ].
	character := source at: position.
	character = $" ifTrue: [ ^ self scanQuoted ].
	(self isWordCharacter: character) ifTrue: [ ^ self scanWord ].
	character = $- ifTrue: [ ^ self scanArrow ].
	position := position + 1.
	^ kind := character
]

{ #category : 'scanning' }
DotScanner >> skipSeparators [
	[ position <= source size and: [ (source at: position) isSeparator ] ] whileTrue: [ position := position + 1 ]
]

{ #category : 'scanning' }
DotScanner >> scanQuoted [
	| start |
	start := position + 1.
	position := start.
	[ (source at: position) = $" ] whileFalse: [ position := position + (self escapeLengthAt: position) ].
	text := source copyFrom: start to: position - 1.
	position := position + 1.
	^ kind := #word
]

{ #category : 'scanning' }
DotScanner >> escapeLengthAt: anIndex [
	^ (source at: anIndex) = $\
		ifTrue: [ 2 ]
		ifFalse: [ 1 ]
]

{ #category : 'scanning' }
DotScanner >> isWordCharacter: aCharacter [
	^ aCharacter isAlphaNumeric or: [ aCharacter = $_ or: [ aCharacter = $. ] ]
]

{ #category : 'scanning' }
DotScanner >> scanWord [
	| start |
	start := position.
	[ position <= source size and: [ self isWordCharacter: (source at: position) ] ] whileTrue: [ position := position + 1 ].
	text := source copyFrom: start to: position - 1.
	^ kind := #word
]

{ #category : 'scanning' }
DotScanner >> scanArrow [
	position := position + 2.
	^ kind := #arrow
]

{ #category : 'accessing' }
DotScanner >> kind [
	^ kind
]

{ #category : 'accessing' }
DotScanner >> text [
	^ text
]
