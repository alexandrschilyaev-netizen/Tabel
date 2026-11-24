import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { brandMark } from './brand-mark';
import { hardware, motion } from './launch-artwork';

const duration = 1340;
const frameWidth = 300;
const frameHeight = 148;
const columns = 6;
const rows = 4;
const frameDuration = 45;

const frames = Array.from({ length: columns * rows }, (_, index) => index);
const frameTimes = [
  0,
  ...frames.slice(1).flatMap(index => [index * frameDuration - .1, index * frameDuration]),
  duration
];
const positions = frames.flatMap(index => [index, index]);

export function BrandLaunch({ onComplete }) {
  const clock = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let active = true;
    let reduced = false;
    const animation = Animated.timing(clock, {
      toValue: duration, duration, easing: Easing.linear, useNativeDriver: true
    });
    function reduceMotion() {
      reduced = true;
      animation.stop();
      clock.setValue(duration);
      if (active) onComplete(true);
    }
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', reduce => {
      if (reduce) reduceMotion();
    });
    function start(reduce) {
      if (!active || reduced) return;
      if (reduce) reduceMotion();
      else animation.start(({ finished }) => { if (active && finished) onComplete(true); });
    }
    AccessibilityInfo.isReduceMotionEnabled().then(start, () => start(true));
    return () => {
      active = false;
      subscription.remove();
      animation.stop();
    };
  }, [onComplete, clock]);

  const opacity = clock.interpolate({
    inputRange: [0, 162, 983, 1080, duration],
    outputRange: [.35, 1, 1, 0, 0]
  });
  const shift = clock.interpolate({
    inputRange: [0, 162, 983, 1080, duration],
    outputRange: [5, 0, 0, -5, -5]
  });
  const frameX = clock.interpolate({
    inputRange: frameTimes,
    outputRange: positions.map(index => -(index % columns) * frameWidth)
  });
  const frameY = clock.interpolate({
    inputRange: frameTimes,
    outputRange: positions.map(index => -Math.floor(index / columns) * frameHeight)
  });
  const logoOpacity = clock.interpolate({ inputRange: [0, 992, duration], outputRange: [0, 0, 1] });
  const logoShift = clock.interpolate({ inputRange: [0, 992, duration], outputRange: [5, 5, 0] });

  return (
    <View style={styles.screen} accessibilityLabel="Открываем табель" accessibilityRole="progressbar">
      <View style={styles.stage} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Animated.View style={[styles.picture, { opacity, transform: [{ translateY: shift }] }]}>
          <Image source={hardware} style={styles.hardware} resizeMode="stretch" fadeDuration={0} />
          <Animated.Image source={motion} style={[styles.frames, {
            transform: [{ translateX: frameX }, { translateY: frameY }]
          }]} resizeMode="stretch" fadeDuration={0} />
        </Animated.View>
        <Animated.View style={[styles.lockup, { opacity: logoOpacity, transform: [{ translateY: logoShift }] }]}>
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
  stage: { width: frameWidth, height: 160, alignItems: 'center', justifyContent: 'center' },
  picture: { width: frameWidth, height: frameHeight, overflow: 'hidden' },
  hardware: { width: frameWidth, height: frameHeight },
  frames: { position: 'absolute', top: 0, left: 0, width: frameWidth * columns, height: frameHeight * rows },
  lockup: { position: 'absolute', flexDirection: 'row', gap: 15, alignItems: 'center' },
  markPlate: { width: 72, height: 72, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
  mark: { width: 46, height: 46 },
  company: { color: '#a3e2ae', fontSize: 11, letterSpacing: 1.1, fontWeight: '750' },
  product: { color: '#ffffff', fontSize: 32, fontWeight: '800' },
  caption: { color: '#c2ddcd', fontSize: 14 }
});
