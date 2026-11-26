Class {
	#name : 'PipelineBin',
	#superclass : 'PipelineElement',
	#instVars : [
		'children'
	],
	#category : 'GStreamer'
}

{ #category : 'initialization' }
PipelineBin >> setAddress: anAddress label: aLabel role: aRole in: aBin [
	super setAddress: anAddress label: aLabel role: aRole in: aBin.
	children := OrderedCollection new
]

{ #category : 'building' }
PipelineBin >> addChild: anElement [
	children add: anElement
]

{ #category : 'views' }
PipelineBin >> gtChildrenFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Children';
		priority: 2;
		items: [ children ];
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
		column: 'Pads' do: [ :column |
			column
				text: [ :each | each pads size printString ];
				fitContent;
				priority: 4 ]
]

{ #category : 'accessing' }
PipelineBin >> summary [
	^ super summary , { 'Children' -> children size printString }
]

{ #category : 'accessing' }
PipelineBin >> children [
	^ children
]

{ #category : 'accessing' }
PipelineBin >> isBin [
	^ true
]
