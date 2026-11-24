Class {
	#name : 'PipelinePalette',
	#superclass : 'Object',
	#instVars : [
		'tones'
	],
	#category : 'GStreamer'
}

{ #category : 'initialization' }
PipelinePalette >> initialize [
	tones := OrderedDictionary new.
	tones
		at: #none put: #( 0 0 0  0 0 0 );
		at: #source put: #( 1.0 0.82 0.82  0.33 0.17 0.18 );
		at: #sink put: #( 0.83 0.84 1.0  0.18 0.2 0.37 );
		at: #filter put: #( 0.83 0.96 0.83  0.15 0.29 0.18 );
		at: #bin put: #( 0.975 0.975 0.98  0.13 0.12 0.15 );
		at: #nestedBin put: #( 0.94 0.945 0.955  0.17 0.16 0.2 );
		at: #border put: #( 0.42 0.44 0.5  0.5 0.52 0.6 );
		at: #sourcePad put: #( 1.0 0.67 0.67  0.6 0.27 0.28 );
		at: #sinkPad put: #( 0.67 0.67 1.0  0.3 0.32 0.66 );
		at: #ghostSourcePad put: #( 1.0 0.87 0.87  0.43 0.27 0.29 );
		at: #ghostSinkPad put: #( 0.87 0.87 1.0  0.26 0.28 0.47 );
		at: #text put: #( 0.1 0.1 0.13  0.91 0.91 0.94 );
		at: #mutedText put: #( 0.36 0.38 0.44  0.66 0.68 0.75 );
		at: #link put: #( 0.38 0.4 0.47  0.6 0.62 0.7 );
		at: #capsText put: #( 0.2 0.3 0.52  0.66 0.76 0.96 );
		at: #highlight put: #( 0.93 0.45 0.05  1.0 0.62 0.2 )
]

{ #category : 'accessing' }
PipelinePalette >> toneOf: aName [
	^ (tones keys indexOf: aName) - 1
]

{ #category : 'accessing' }
PipelinePalette >> values [
	^ tones values flatCollect: [ :each | each ]
]
