Class {
	#name : 'DotGraph',
	#superclass : 'Object',
	#instVars : [
		'id',
		'attributes',
		'defaults',
		'nodes',
		'edges',
		'subgraphs'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
DotGraph class >> id: aString [
	^ self new setId: aString
]

{ #category : 'initialization' }
DotGraph >> setId: aString [
	id := aString.
	attributes := Dictionary new.
	defaults := Dictionary new.
	nodes := OrderedCollection new.
	edges := OrderedCollection new.
	subgraphs := OrderedCollection new
]

{ #category : 'building' }
DotGraph >> addSubgraph: aGraph [
	subgraphs add: aGraph
]

{ #category : 'building' }
DotGraph >> addEdge: anEdge [
	edges add: anEdge
]

{ #category : 'building' }
DotGraph >> addNode: aNode [
	nodes add: aNode
]

{ #category : 'accessing' }
DotGraph >> id [
	^ id
]

{ #category : 'accessing' }
DotGraph >> attributes [
	^ attributes
]

{ #category : 'accessing' }
DotGraph >> defaults [
	^ defaults
]

{ #category : 'accessing' }
DotGraph >> nodes [
	^ nodes
]

{ #category : 'accessing' }
DotGraph >> edges [
	^ edges
]

{ #category : 'accessing' }
DotGraph >> subgraphs [
	^ subgraphs
]
