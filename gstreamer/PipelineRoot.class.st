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
		column: 'Name' do: [ :column |
			column
				text: [ :each | each name ];
				priority: 1;
				minimumCharacters: 12 ];
		column: 'Type' do: [ :column |
			column
				text: [ :each | each type ];
				priority: 2 ];
		column: 'State' do: [ :column |
			column
				text: [ :each | each stateText ];
				fitContent;
				priority: 3 ];
		column: 'Bin' do: [ :column |
			column
				text: [ :each | each binPath ];
				priority: 4 ];
		column: 'Pads' do: [ :column |
			column
				text: [ :each | each pads size printString ];
				fitContent;
				priority: 5 ]
]

{ #category : 'views' }
PipelineRoot >> gtLinksFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Links';
		priority: 7;
		items: [ links ];
		column: 'From' do: [ :column |
			column
				text: [ :each | each from fullName ];
				priority: 1 ];
		column: 'To' do: [ :column |
			column
				text: [ :each | each to fullName ];
				priority: 2 ];
		column: 'Media type' do: [ :column |
			column
				text: [ :each | each mediaType ];
				priority: 3 ]
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
