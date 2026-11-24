Class {
	#name : 'DotParser',
	#superclass : 'Object',
	#instVars : [
		'scanner'
	],
	#category : 'GStreamer'
}

{ #category : 'parsing' }
DotParser class >> parse: aString [
	^ self new
		setScanner: (DotScanner on: aString);
		graph
]

{ #category : 'initialization' }
DotParser >> setScanner: aScanner [
	scanner := aScanner
]

{ #category : 'parsing' }
DotParser >> graph [
	| graph |
	scanner advance; advance.
	graph := DotGraph id: scanner text.
	scanner advance; advance.
	self readStatementsInto: graph.
	^ graph
]

{ #category : 'parsing' }
DotParser >> readStatementsInto: aGraph [
	[ scanner kind = $} ] whileFalse: [ self readStatementInto: aGraph ].
	scanner advance
]

{ #category : 'parsing' }
DotParser >> readStatementInto: aGraph [
	self readStatementStartingWith: self word into: aGraph.
	scanner kind = $; ifTrue: [ scanner advance ]
]

{ #category : 'parsing' }
DotParser >> word [
	| word |
	word := scanner text.
	scanner advance.
	^ word
]

{ #category : 'parsing' }
DotParser >> readStatementStartingWith: anId into: aGraph [
	anId = 'subgraph' ifTrue: [ ^ aGraph addSubgraph: self subgraph ].
	scanner kind = $= ifTrue: [ ^ aGraph attributes at: anId put: self assignedWord ].
	scanner kind = #arrow ifTrue: [ ^ aGraph addEdge: (self edgeFrom: anId) ].
	(#( 'node' 'edge' ) includes: anId) ifTrue: [ ^ aGraph defaults at: anId put: self attributeList ].
	aGraph addNode: (DotNode id: anId attributes: self attributeList)
]

{ #category : 'parsing' }
DotParser >> subgraph [
	| graph |
	graph := DotGraph id: self word.
	scanner advance.
	self readStatementsInto: graph.
	^ graph
]

{ #category : 'parsing' }
DotParser >> assignedWord [
	scanner advance.
	^ self word
]

{ #category : 'parsing' }
DotParser >> edgeFrom: aTail [
	| head |
	scanner advance.
	head := self word.
	^ DotEdge from: aTail to: head attributes: self attributeList
]

{ #category : 'parsing' }
DotParser >> attributeList [
	| attributes |
	attributes := Dictionary new.
	scanner kind = $[ ifFalse: [ ^ attributes ].
	scanner advance.
	[ scanner kind = $] ] whileFalse: [ self readAttributeInto: attributes ].
	scanner advance.
	^ attributes
]

{ #category : 'parsing' }
DotParser >> readAttributeInto: aDictionary [
	aDictionary at: self word put: self assignedWord.
	scanner kind = $, ifTrue: [ scanner advance ]
]
