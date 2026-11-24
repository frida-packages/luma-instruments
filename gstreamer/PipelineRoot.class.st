Class {
	#name : 'PipelineRoot',
	#superclass : 'PipelineBin',
	#instVars : [
		'descendants',
		'links',
		'dot'
	],
	#category : 'GStreamer'
}

{ #category : 'building' }
PipelineRoot >> descendants: someElements links: someLinks dot: aString [
	descendants := someElements.
	links := someLinks.
	dot := aString
]

{ #category : 'views' }
PipelineRoot >> gtElementsFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Elements';
		priority: 6;
		items: [ descendants ];
		column: 'Name' text: [ :each | each name ];
		column: 'Type' text: [ :each | each type ];
		column: 'State' text: [ :each | each stateText ];
		column: 'Bin' text: [ :each | each binPath ];
		column: 'Pads' text: [ :each | each pads size printString ]
]

{ #category : 'views' }
PipelineRoot >> gtLinksFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Links';
		priority: 7;
		items: [ links ];
		column: 'From' text: [ :each | each from fullName ];
		column: 'To' text: [ :each | each to fullName ];
		column: 'Media type' text: [ :each | each mediaType ]
]

{ #category : 'views' }
PipelineRoot >> gtDotFor: aView [
	<gtView>
	^ aView text
		title: 'Dot';
		priority: 8;
		text: [ dot ]
]

{ #category : 'accessing' }
PipelineRoot >> dot [
	^ dot
]
