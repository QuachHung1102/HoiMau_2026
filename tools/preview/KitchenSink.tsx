import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useReducedMotion } from '../../src/shared/motion/useReducedMotion';

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#F7F9FC' },
  content: { padding: 16, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: '#E3E8F0' },
  h: { fontSize: 20, fontWeight: '700', color: '#182743' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btn: { backgroundColor: '#E5484D', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16 },
  btnText: { color: '#fff', fontWeight: '600' },
  bar: { height: 8, borderRadius: 4, backgroundColor: '#E5484D' },
});

// Created per mount, never at module scope: a module-level client leaves a gc timer that keeps Jest open.
function makeClient() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  client.setQueryData(['profile'], { name: 'Nguyễn Thị Hương', level: 7 });
  return client;
}

function Home() {
  const insets = useSafeAreaInsets();
  const { data } = useQuery({ queryKey: ['profile'], queryFn: (): Promise<{ name: string; level: number }> => Promise.reject(new Error('not seeded')), staleTime: Infinity });
  const [taps, setTaps] = useState(0);
  const w = useRef(new Animated.Value(40)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      w.setValue(220);
      return;
    }
    Animated.timing(w, { toValue: 220, duration: 200, useNativeDriver: false }).start();
  }, [w, reduced]);
  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.h}>Hồi Máu — Tiếng Việt: ắằẳẵặ ếềểễệ ơờởỡợ ưừửữự đ</Text>
        <Text>Insets (top/bottom): {insets.top}/{insets.bottom}</Text>
      </View>
      <View style={[styles.card, styles.row]}>
        {/* decorative: hidden from screen readers */}
        <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.row}>
          <Heart color="#E5484D" size={28} />
          <Svg width={120} height={48}>
            <Circle cx={24} cy={24} r={20} fill="#3E63DD" />
            <Rect x={52} y={8} width={32} height={32} rx={6} fill="#30A46C" />
            <Path d="M92 40 L106 8 L120 40 Z" fill="#F5A524" />
          </Svg>
        </View>
        <Text>SVG + lucide</Text>
      </View>
      <View style={styles.card}>
        <Text>Query (pre-seeded): {data ? `${data.name} · cấp ${data.level}` : 'no data'}</Text>
        <Animated.View style={[styles.bar, { width: w }]} />
      </View>
      <Pressable accessibilityRole="button" style={styles.btn} onPress={() => setTaps(t => t + 1)}>
        <Text style={styles.btnText}>Bấm ({taps})</Text>
      </Pressable>
    </ScrollView>
  );
}

const TabIcon = ({ color, size }: { color: string; size: number }) => <Heart color={color} size={size} />;

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function HomeStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Home" component={Home} options={{ title: 'Hồi Máu' }} />
    </Stack.Navigator>
  );
}

function Other() {
  return (
    <View style={[styles.fill, styles.content]}>
      <Text style={styles.h}>Tab khác</Text>
    </View>
  );
}

export function KitchenSink() {
  const [queryClient] = useState(makeClient);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <Tab.Navigator screenOptions={{ headerShown: false, tabBarIcon: TabIcon }}>
            <Tab.Screen name="Trang chủ" component={HomeStack} />
            <Tab.Screen name="Khác" component={Other} />
          </Tab.Navigator>
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
