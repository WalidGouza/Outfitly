import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from "react-native-svg";
import { photoSource, type Category, type Piece } from "@/api";
import { useSession } from "@/session";
import { font, useTheme } from "@/theme";

// The web app's flat garment drawings, used for sample pieces (frontend/src/main.tsx).
function Shape({ category }: { category: Category }) {
  if (category === "tops")
    return (
      <>
        <Path d="M64 34 88 24 Q110 42 132 24 L156 34 185 73 157 94 145 76 145 180 75 180 75 76 63 94 35 73Z" />
        <Path d="M88 24Q110 57 132 24" fill="none" stroke="#666" opacity={0.25} />
      </>
    );
  if (category === "pants")
    return (
      <>
        <Path d="M72 26H148L158 184H116L110 96 104 184H62Z" />
        <Path d="M72 42H148M110 42V88M77 44Q78 64 64 68M143 44Q142 64 153 68" fill="none" stroke="#fff" opacity={0.25} />
      </>
    );
  if (category === "shoes")
    return (
      <>
        <Path d="M37 91 56 69 77 86 129 94 155 109Q185 110 184 133H40Q23 116 37 91Z" />
        <Path d="M47 143H178V154H47Z" fill="#d4d0c7" />
        <Path d="M85 87 76 106M102 91 94 109M117 95 111 111" stroke="#fff" strokeWidth={5} />
        <Path d="M54 55 74 37 94 51 145 59 173 75Q198 81 196 97L135 96 77 83Z" opacity={0.65} />
      </>
    );
  return (
    <>
      <Path d="M77 29 95 23H125L143 29 176 59 185 168 154 174 142 75 145 189H75L78 75 66 174 35 168 44 59Z" />
      <Path d="M95 23 110 51 125 23M110 51V189M84 92H101V119H84M119 92H136V119H119" fill="none" stroke="#fff" opacity={0.35} />
      {[66, 91, 116, 141, 166].map((y) => (
        <Circle key={y} cx={111} cy={y} r={2} fill="#555" />
      ))}
    </>
  );
}

export function GarmentIllustration({ piece }: { piece: Piece }) {
  const id = `fabric-${piece.id}`;
  return (
    <Svg viewBox="0 0 220 210" width="88%" height="88%">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={piece.color} />
          <Stop offset="0.5" stopColor={piece.color} />
          <Stop offset="1" stopColor="#000" stopOpacity={0.25} />
        </LinearGradient>
      </Defs>
      <G fill={`url(#${id})`}>
        <Shape category={piece.category} />
      </G>
    </Svg>
  );
}

/** A piece's photo (fetched with the session token) or its sample illustration. */
export function PieceArt({ piece, rounded = 14 }: { piece: Piece; rounded?: number }) {
  const t = useTheme();
  const { token } = useSession();
  const [failed, setFailed] = useState(false);
  return (
    <View style={[styles.frame, { backgroundColor: t.board, borderRadius: rounded }]}>
      {piece.image && token ? (
        failed ? (
          <Text style={[styles.missing, { color: t.muted }]}>Photo unavailable</Text>
        ) : (
          <Image
            source={photoSource(piece.image, token)}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            transition={180}
            accessibilityLabel={piece.name}
            onError={() => setFailed(true)}
          />
        )
      ) : (
        <GarmentIllustration piece={piece} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  missing: { fontFamily: font.regular, fontSize: 12, textAlign: "center", padding: 8 },
});
