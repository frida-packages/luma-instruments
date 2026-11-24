Class {
	#name : 'GraphLettering',
	#superclass : 'Object',
	#instVars : [
		'drawable',
		'glyphs',
		'advances',
		'origins',
		'cellWidth',
		'cellHeight',
		'sheetWidth',
		'sheetHeight',
		'inkTop',
		'inkBottom'
	],
	#category : 'GStreamer'
}

{ #category : 'instance creation' }
GraphLettering class >> on: aDrawable [
	^ self new setDrawable: aDrawable
]

{ #category : 'initialization' }
GraphLettering >> setDrawable: aDrawable [
	drawable := aDrawable.
	glyphs := LumaGlyphs pointSize: 22 for: aDrawable.
	glyphs applyTo: aDrawable.
	advances := (glyphs first to: glyphs last) collect: [ :each | glyphs advanceOf: (Character value: each) ].
	origins := (glyphs first to: glyphs last) collect: [ :each | glyphs cellOrigin: each ].
	cellWidth := glyphs cellWidth.
	cellHeight := glyphs cellHeight.
	sheetWidth := glyphs sheetWidth.
	sheetHeight := glyphs sheetHeight.
	inkTop := glyphs inkTop.
	inkBottom := glyphs inkBottom
]

{ #category : 'measuring' }
GraphLettering >> widthOf: aString size: aSize [
	^ (aString inject: 0 into: [ :sum :each | sum + (self advanceOf: each) ]) * aSize / glyphs pixelSize
]

{ #category : 'measuring' }
GraphLettering >> advanceOf: aCharacter [
	^ advances at: (self indexOf: aCharacter)
]

{ #category : 'measuring' }
GraphLettering >> indexOf: aCharacter [
	(aCharacter asInteger between: glyphs first and: glyphs last) ifTrue: [ ^ aCharacter asInteger - glyphs first + 1 ].
	^ $? asInteger - glyphs first + 1
]

{ #category : 'measuring' }
GraphLettering >> lineHeight: aSize [
	^ cellHeight * aSize / glyphs pixelSize
]

{ #category : 'measuring' }
GraphLettering >> truncated: aString size: aSize width: aWidth [
	| kept |
	(self widthOf: aString size: aSize) <= aWidth ifTrue: [ ^ aString ].
	kept := aString.
	[ kept notEmpty and: [ (self widthOf: kept , '...' size: aSize) > aWidth ] ] whileTrue: [ kept := kept allButLast ].
	^ kept , '...'
]

{ #category : 'writing' }
GraphLettering >> write: aString size: aSize at: aPoint depth: aDepth tone: aTone into: aStream [
	| scale pen |
	scale := aSize / glyphs pixelSize.
	pen := aPoint x.
	aString do: [ :each |
		each = Character space ifFalse: [ self writeGlyph: (origins at: (self indexOf: each)) at: pen @ aPoint y scale: scale depth: aDepth tone: aTone into: aStream ].
		pen := pen + ((self advanceOf: each) * scale) ]
]

{ #category : 'writing' }
GraphLettering >> writeGlyph: anOrigin at: aPoint scale: aScale depth: aDepth tone: aTone into: aStream [
	| right bottom u v uRight vBottom |
	right := aPoint x + (cellWidth * aScale).
	bottom := aPoint y + ((inkBottom - inkTop) * aScale).
	u := anOrigin x / sheetWidth.
	uRight := anOrigin x + cellWidth / sheetWidth.
	v := anOrigin y + inkTop / sheetHeight.
	vBottom := anOrigin y + inkBottom / sheetHeight.
	#( #( 0 0 ) #( 1 0 ) #( 0 1 ) #( 1 0 ) #( 1 1 ) #( 0 1 ) ) do: [ :corner |
		aStream
			add: (corner first = 0 ifTrue: [ aPoint x ] ifFalse: [ right ]);
			add: (corner last = 0 ifTrue: [ aPoint y ] ifFalse: [ bottom ]);
			add: aDepth;
			add: (corner first = 0 ifTrue: [ u ] ifFalse: [ uRight ]);
			add: (corner last = 0 ifTrue: [ v ] ifFalse: [ vBottom ]);
			add: aTone ]
]

{ #category : 'accessing' }
GraphLettering >> drawable [
	^ drawable
]
