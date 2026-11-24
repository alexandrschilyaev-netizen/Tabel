import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { brandMark } from './brand-mark';

const duration = 1340;
const terminals = [0, 1, 2, 3];

export function BrandLaunch({ onComplete }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let active = true;
    const animation = Animated.timing(progress, {
      toValue: 1, duration, easing: Easing.linear, useNativeDriver: true
    });
    function reduceMotion() {
      animation.stop();
      progress.setValue(1);
      if (active) onComplete(true);
    }
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', reduce => {
      if (reduce) reduceMotion();
    });
    function start(reduce) {
      if (!active) return;
      if (reduce) reduceMotion();
      else animation.start(({ finished }) => { if (active && finished) onComplete(true); });
    }
    AccessibilityInfo.isReduceMotionEnabled().then(start, () => start(true));
    return () => {
      active = false;
      subscription.remove();
      animation.stop();
    };
  }, [onComplete, progress]);

  return (
    <View style={styles.screen} accessibilityLabel="Открываем табель" accessibilityRole="progressbar">
      <View style={styles.stage} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Animated.View style={[styles.circuit, {
          opacity: progress.interpolate({ inputRange: [0, .18, .62, .86, 1], outputRange: [.3, 1, 1, 0, 0] }),
          transform: [{ translateY: progress.interpolate({ inputRange: [0, .18, .62, 1], outputRange: [8, 0, 0, -8] }) }]
        }]}>
          <View style={styles.module}>
            <Text style={styles.unitTitle}>ПЛК</Text>
            <Animated.View style={[styles.ledRow, {
              opacity: progress.interpolate({ inputRange: [0, .12, .22, 1], outputRange: [.3, .3, 1, 1] })
            }]}>
              {terminals.map(i => <View key={i} style={[styles.led, i % 2 === 1 && styles.ledDim]} />)}
            </Animated.View>
            <View style={styles.terminals}>{terminals.map(i => <View key={i} style={styles.terminal} />)}</View>
          </View>
          <View style={styles.wire}>
            <Animated.View style={[styles.signal, {
              opacity: progress.interpolate({ inputRange: [0, .18, .26, .52, .59, 1], outputRange: [0, 0, 1, 1, 0, 0] }),
              transform: [{ translateX: progress.interpolate({ inputRange: [0, .18, .59, 1], outputRange: [0, 0, 54, 54] }) }]
            }]} />
          </View>
          <View style={styles.module}>
            <Text style={styles.unitTitle}>ЧРП</Text>
            <Animated.Text style={[styles.frequency, {
              opacity: progress.interpolate({ inputRange: [0, .47, .6, 1], outputRange: [.25, .25, 1, 1] })
            }]}>50,0 Гц</Animated.Text>
            <View style={styles.terminals}>{terminals.map(i => <View key={i} style={styles.terminal} />)}</View>
          </View>
        </Animated.View>
        <Animated.View style={[styles.lockup, {
          opacity: progress.interpolate({ inputRange: [0, .68, 1], outputRange: [0, 0, 1] }),
          transform: [{ translateY: progress.interpolate({ inputRange: [0, .68, 1], outputRange: [5, 5, 0] }) }]
        }]}>
          <View style={styles.markPlate}><Image source={brandMark} style={styles.mark} resizeMode="contain" /></View>
          <View>
            <Text style={styles.company}>ГРУППА «ПРИВОД»</Text>
            <Text style={styles.product}>Табель</Text>
          </View>
        </Animated.View>
      </View>
      <Text style={styles.caption}>Открываем табель…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0b251c' },
  stage: { width: 280, height: 150, alignItems: 'center', justifyContent: 'center' },
  circuit: { flexDirection: 'row', alignItems: 'center' },
  module: { width: 87, height: 104, backgroundColor: '#1f4836', borderColor: '#739988', borderWidth: 1,
    borderRadius: 10, padding: 10 },
  unitTitle: { color: '#d8e9de', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  ledRow: { flexDirection: 'row', gap: 6, marginTop: 16 },
  led: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#a3e2ae' },
  ledDim: { opacity: .45 },
  terminals: { marginTop: 'auto', flexDirection: 'row', gap: 6 },
  terminal: { width: 5, height: 9, borderRadius: 1, backgroundColor: '#668977' },
  wire: { width: 72, height: 1, backgroundColor: '#5e9177' },
  signal: { width: 18, height: 3, top: -1, borderRadius: 2, backgroundColor: '#a3e2ae' },
  frequency: { paddingVertical: 5, paddingHorizontal: 3, marginTop: 7, color: '#a3e2ae', backgroundColor: '#10251d',
    borderColor: '#4d7564', borderWidth: 1, borderRadius: 4, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  lockup: { position: 'absolute', flexDirection: 'row', gap: 15, alignItems: 'center' },
  markPlate: { width: 72, height: 72, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
  mark: { width: 46, height: 46 },
  company: { color: '#a3e2ae', fontSize: 11, letterSpacing: 1.1, fontWeight: '750' },
  product: { color: '#ffffff', fontSize: 32, fontWeight: '800' },
  caption: { color: '#c2ddcd', fontSize: 14 }
});
