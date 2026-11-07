import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import {
  exportAndShareExcelReport,
  fetchOrganizations,
  fetchReportData,
  formatDateYMD,
  OrganizationItem,
} from '@/features/reviews/services/report.service';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const COLLAPSED_OFFSET = Math.round(SCREEN_HEIGHT * 0.35); // collapsed offset

export interface ExportReportBottomSheetProps {
  visible: boolean;
  onClose: () => void;
}

function parseYMD(str: string): Date {
  const parts = str.split('-').map(Number);
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return new Date();
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function ExportReportBottomSheet({
  visible,
  onClose,
}: ExportReportBottomSheetProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(COLLAPSED_OFFSET)).current;
  const isExpandedRef = useRef(false);
  const scrollOffsetRef = useRef(0);
  const scrollViewRef = useRef<any>(null);
  const [scrollEnabled, setScrollEnabled] = useState(false);
  const dragStartOffsetRef = useRef(0);
  const closingRef = useRef(false);

  // Step 1: Vendor Selection; Step 2: Date Selection
  const [step, setStep] = useState<1 | 2>(1);

  // Organizations list & selection
  const [organizations, setOrganizations] = useState<OrganizationItem[]>([]);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrgIds, setSelectedOrgIds] = useState<Set<string | number>>(new Set());

  // Date selection states
  // Default: yesterday as end date, 7 days ago as start date
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);

  const [startDateStr, setStartDateStr] = useState(formatDateYMD(sevenDaysAgo));
  const [endDateStr, setEndDateStr] = useState(formatDateYMD(yesterday));
  const [presetSelected, setPresetSelected] = useState<'7d' | '30d' | 'yesterday' | 'custom'>('7d');

  // Calendar picker state
  const [calendarTarget, setCalendarTarget] = useState<'start' | 'end' | null>(null);
  const [viewDate, setViewDate] = useState<Date>(() => yesterday);

  // Export progress
  const [isExporting, setIsExporting] = useState(false);

  function animateToExpanded() {
    isExpandedRef.current = true;
    setScrollEnabled(true);
    Animated.spring(translateY, {
      toValue: 0,
      damping: 24,
      stiffness: 220,
      useNativeDriver: true,
    }).start();
  }

  function animateToCollapsed() {
    isExpandedRef.current = false;
    setScrollEnabled(false);
    Animated.spring(translateY, {
      toValue: COLLAPSED_OFFSET,
      damping: 24,
      stiffness: 220,
      useNativeDriver: true,
    }).start();
  }

  function handleClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    Animated.timing(translateY, {
      toValue: SCREEN_HEIGHT,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  }

  function handleWheel(e: any) {
    if (Platform.OS !== 'web') return;
    const deltaY = e?.deltaY ?? e?.nativeEvent?.deltaY ?? 0;
    if (!isExpandedRef.current && deltaY > 2) {
      animateToExpanded();
    } else if (isExpandedRef.current && scrollOffsetRef.current <= 0 && deltaY < -15) {
      animateToCollapsed();
    }
  }

  // Animate sheet opening & closing
  useEffect(() => {
    if (visible) {
      setStep(1);
      setIsExporting(false);
      setSearchQuery('');
      setSelectedOrgIds(new Set());
      closingRef.current = false;
      isExpandedRef.current = false;
      scrollOffsetRef.current = 0;
      setScrollEnabled(false);
      translateY.setValue(SCREEN_HEIGHT);
      loadOrgs();
      Animated.spring(translateY, {
        toValue: COLLAPSED_OFFSET,
        useNativeDriver: true,
        damping: 24,
        stiffness: 220,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  async function loadOrgs() {
    setIsLoadingOrgs(true);
    try {
      const list = await fetchOrganizations();
      // Ensure strict deduplication by normalized name
      const uniqueList: OrganizationItem[] = [];
      const seen = new Set<string>();
      for (const item of list) {
        const norm = item.name.trim().toLowerCase();
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          uniqueList.push(item);
        }
      }
      setOrganizations(uniqueList);
      // Start with empty selection so user can pick freely
      setSelectedOrgIds(new Set());
    } catch {
      // Handled
    } finally {
      setIsLoadingOrgs(false);
    }
  }

  // PanResponder with expand / collapse support like NotificationCenterModal
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        const isDragging = Math.abs(gestureState.dy) > 4;
        if (!isDragging) return false;
        if (!isExpandedRef.current) {
          return true; // Sheet must expand or collapse first
        }
        return gestureState.dy > 0 && scrollOffsetRef.current <= 0;
      },
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        const isDragging = Math.abs(gestureState.dy) > 4;
        if (!isDragging) return false;
        if (!isExpandedRef.current) {
          return true;
        }
        return gestureState.dy > 0 && scrollOffsetRef.current <= 0;
      },
      onPanResponderGrant: () => {
        dragStartOffsetRef.current = isExpandedRef.current ? 0 : COLLAPSED_OFFSET;
      },
      onPanResponderMove: (_, gestureState) => {
        const currentTargetY = dragStartOffsetRef.current + gestureState.dy;

        if (!isExpandedRef.current) {
          if (currentTargetY <= 0) {
            translateY.setValue(0);
            const overflowScroll = -currentTargetY;
            scrollViewRef.current?.scrollTo({ y: overflowScroll, animated: false });
            scrollOffsetRef.current = overflowScroll;
            if (!scrollEnabled) {
              setScrollEnabled(true);
            }
          } else {
            translateY.setValue(currentTargetY);
          }
        } else {
          if (currentTargetY > 0) {
            translateY.setValue(currentTargetY);
          }
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const currentTargetY = dragStartOffsetRef.current + gestureState.dy;

        if (!isExpandedRef.current) {
          // Dragged up significantly or flicked up -> expand
          if (gestureState.dy < -10 || gestureState.vy < -0.1 || currentTargetY < COLLAPSED_OFFSET * 0.85) {
            animateToExpanded();
          } else if (gestureState.vy > 0.5 || currentTargetY > COLLAPSED_OFFSET + 70) {
            handleClose();
          } else {
            animateToCollapsed();
          }
        } else {
          // Was expanded and pulled down:
          if (gestureState.vy > 0.6 || gestureState.dy > COLLAPSED_OFFSET * 0.75) {
            handleClose();
          } else if (gestureState.dy > 30) {
            animateToCollapsed();
          } else {
            animateToExpanded();
          }
        }
      },
      onPanResponderTerminate: () => {
        if (isExpandedRef.current) {
          animateToExpanded();
        } else {
          animateToCollapsed();
        }
      },
    })
  ).current;

  // Filter organizations by search
  const filteredOrgs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return organizations;
    return organizations.filter((o) => o.name.toLowerCase().includes(q));
  }, [organizations, searchQuery]);

  // Select all toggle
  const isAllSelected =
    filteredOrgs.length > 0 &&
    filteredOrgs.every((o) => selectedOrgIds.has(o.id));

  function toggleSelectAll() {
    const next = new Set(selectedOrgIds);
    if (isAllSelected) {
      filteredOrgs.forEach((o) => next.delete(o.id));
    } else {
      filteredOrgs.forEach((o) => next.add(o.id));
    }
    setSelectedOrgIds(next);
  }

  function toggleOrg(id: string | number) {
    const next = new Set(selectedOrgIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedOrgIds(next);
  }

  // Calendar Navigation Handlers
  function goToPrevMonth() {
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }

  function goToNextMonth() {
    const next = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    const today = new Date();
    if (
      next.getFullYear() > today.getFullYear() ||
      (next.getFullYear() === today.getFullYear() && next.getMonth() > today.getMonth())
    ) {
      return;
    }
    setViewDate(next);
  }

  function handleSelectCalendarDay(day: number) {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const dStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (calendarTarget === 'start') {
      setStartDateStr(dStr);
    } else if (calendarTarget === 'end') {
      setEndDateStr(dStr);
    }
    setPresetSelected('custom');
    setCalendarTarget(null);
  }

  // Preset Date Handlers
  function applyDatePreset(preset: 'yesterday' | '7d' | '30d') {
    setPresetSelected(preset);
    const n = new Date();
    const y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
    const yStr = formatDateYMD(y);
    setEndDateStr(yStr);

    if (preset === 'yesterday') {
      setStartDateStr(yStr);
    } else if (preset === '7d') {
      const past7 = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 7);
      setStartDateStr(formatDateYMD(past7));
    } else if (preset === '30d') {
      const past30 = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 30);
      setStartDateStr(formatDateYMD(past30));
    }
  }

  // Handle Export Execution
  async function handleExport() {
    // Validate date constraints
    const todayStr = formatDateYMD(new Date());
    if (startDateStr >= todayStr || endDateStr >= todayStr) {
      Alert.alert(
        'Invalid Date Selection',
        "Today's date cannot be selected. Please pick historical past dates only."
      );
      return;
    }

    if (startDateStr > endDateStr) {
      Alert.alert(
        'Invalid Date Range',
        'Start date cannot be after end date.'
      );
      return;
    }

    const selectedOrgsList = organizations.filter((o) =>
      selectedOrgIds.has(o.id)
    );
    if (selectedOrgsList.length === 0) {
      Alert.alert('Selection Error', 'Please select at least one organization.');
      return;
    }

    setIsExporting(true);
    try {
      const sections = await fetchReportData(
        selectedOrgsList,
        startDateStr,
        endDateStr
      );

      if (sections.length === 0) {
        Alert.alert(
          'No Data Found',
          'No organizations available to export.'
        );
        setIsExporting(false);
        return;
      }

      await exportAndShareExcelReport(sections);
      handleClose();
    } catch (err: any) {
      console.warn('[ExportReportBottomSheet] Export failed:', err);
      Alert.alert('Export Error', err?.message || 'Failed to export Excel report.');
    } finally {
      setIsExporting(false);
    }
  }

  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const todayStr = formatDateYMD(new Date());

  const canGoNextMonth = !(
    viewYear > now.getFullYear() ||
    (viewYear === now.getFullYear() && viewMonth >= now.getMonth())
  );

  if (!visible) return null;

  return (
    <Modal
      animationType="none"
      onRequestClose={handleClose}
      transparent={true}
      visible={visible}>
      <View style={styles.overlay}>
        <Pressable onPress={handleClose} style={styles.backdrop} />

        <Animated.View
          {...panResponder.panHandlers}
          {...(Platform.OS === 'web' ? ({ onWheel: handleWheel } as any) : {})}
          style={[
            styles.container,
            {
              paddingBottom: Math.max(insets.bottom, 16),
              transform: [{ translateY }],
            },
          ]}>
          {/* Drag Handle */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Expand or collapse sheet"
            onPress={() => {
              if (isExpandedRef.current) {
                animateToCollapsed();
              } else {
                animateToExpanded();
              }
            }}
            style={styles.dragHandleContainer}>
            <View style={styles.dragHandle} />
          </Pressable>

          {/* Header */}
          <View style={styles.headerRow}>
            <Pressable
              onPress={() => {
                if (!isExpandedRef.current) {
                  animateToExpanded();
                }
              }}
              style={{ flex: 1 }}>
              <Text style={styles.title}>Export Review Report</Text>
              <Text style={styles.subtitle}>
                {step === 1
                  ? 'Step 1: Select Vendors / Organizations'
                  : 'Step 2: Select Date Range (Past Dates)'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={handleClose}
              style={styles.closeBtn}>
              <Icon
                color="#64748b"
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={20}
              />
            </Pressable>
          </View>

          {/* Stepper Indicator */}
          <View style={styles.stepperContainer}>
            <View
              style={[
                styles.stepCircle,
                step >= 1 && styles.stepCircleActive,
              ]}>
              <Text
                style={[
                  styles.stepNumber,
                  step >= 1 && styles.stepNumberActive,
                ]}>
                1
              </Text>
            </View>
            <View
              style={[
                styles.stepLine,
                step === 2 && styles.stepLineActive,
              ]}
            />
            <View
              style={[
                styles.stepCircle,
                step === 2 && styles.stepCircleActive,
              ]}>
              <Text
                style={[
                  styles.stepNumber,
                  step === 2 && styles.stepNumberActive,
                ]}>
                2
              </Text>
            </View>
          </View>

          {/* Step 1: Organizations Multi-Select */}
          {step === 1 && (
            <View style={styles.stepContent}>
              {/* Search Box */}
              <View style={styles.searchBox}>
                <Icon
                  color="#94a3b8"
                  name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                  size={18}
                />
                <TextInput
                  placeholder="Search organization..."
                  placeholderTextColor="#94a3b8"
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                  <Pressable onPress={() => setSearchQuery('')}>
                    <Icon
                      color="#94a3b8"
                      name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
                      size={16}
                    />
                  </Pressable>
                )}
              </View>

              {/* Select All Toggle Bar */}
              <View style={styles.selectAllRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={toggleSelectAll}
                  style={styles.checkboxTouch}>
                  <View
                    style={[
                      styles.checkbox,
                      isAllSelected && styles.checkboxChecked,
                    ]}>
                    {isAllSelected && (
                      <Icon
                        color="#ffffff"
                        name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                        size={14}
                        weight="bold"
                      />
                    )}
                  </View>
                  <Text style={styles.selectAllText}>
                    {isAllSelected ? 'Deselect All' : 'Select All'} ({selectedOrgIds.size} of {organizations.length})
                  </Text>
                </Pressable>
              </View>

              {/* Scrollable Organizations List */}
              {isLoadingOrgs ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator color="#00376f" size="small" />
                  <Text style={styles.loadingText}>Loading organizations...</Text>
                </View>
              ) : (
                <ScrollView
                  ref={scrollViewRef}
                  scrollEnabled={scrollEnabled}
                  onScroll={(e) => {
                    const y = e.nativeEvent.contentOffset.y;
                    scrollOffsetRef.current = y;
                    if (!isExpandedRef.current && y > 2) {
                      animateToExpanded();
                    }
                  }}
                  scrollEventThrottle={16}
                  contentContainerStyle={styles.orgListScroll}
                  showsVerticalScrollIndicator={true}
                  style={styles.orgList}>
                  {filteredOrgs.map((org, index) => {
                    const isSelected = selectedOrgIds.has(org.id);
                    return (
                      <View key={`org_${org.id}_${index}`} style={{ width: '100%' }}>
                        <Pressable
                          onPress={() => toggleOrg(org.id)}
                          style={({ pressed }) => [
                            styles.orgItem,
                            isSelected && styles.orgItemSelected,
                            pressed && { opacity: 0.8 },
                          ]}>
                          <View style={styles.orgItemLeft}>
                            <View
                              style={[
                                styles.orgAvatar,
                                isSelected && styles.orgAvatarSelected,
                              ]}>
                              <Icon
                                color={isSelected ? '#00376f' : '#64748b'}
                                name={{
                                  ios: 'building.2',
                                  android: 'business',
                                  web: 'business',
                                }}
                                size={18}
                              />
                            </View>
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.orgItemName,
                                isSelected && styles.orgItemNameSelected,
                              ]}>
                              {org.name}
                            </Text>
                          </View>

                          <View
                            style={[
                              styles.checkbox,
                              isSelected && styles.checkboxChecked,
                            ]}>
                            {isSelected && (
                              <Icon
                                color="#ffffff"
                                name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                                size={14}
                                weight="bold"
                              />
                            )}
                          </View>
                        </Pressable>
                      </View>
                    );
                  })}
                  {filteredOrgs.length === 0 && (
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyText}>No matching organizations found.</Text>
                    </View>
                  )}
                </ScrollView>
              )}

              {/* Step 1 Footer Action */}
              <View style={styles.footerRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={selectedOrgIds.size === 0}
                  onPress={() => {
                    scrollOffsetRef.current = 0;
                    setStep(2);
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    selectedOrgIds.size === 0 && styles.buttonDisabled,
                    pressed && { opacity: 0.8 },
                  ]}>
                  <Text style={styles.primaryButtonText}>
                    Next: Select Date Range ({selectedOrgIds.size})
                  </Text>
                  <Icon
                    color="#ffffff"
                    name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }}
                    size={16}
                    weight="bold"
                  />
                </Pressable>
              </View>
            </View>
          )}

          {/* Step 2: Date Selection */}
          {step === 2 && (
            <View style={styles.stepContent}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
                style={{ flex: 1 }}>
                <Text style={styles.sectionLabel}>Date Range Presets</Text>
                <View style={styles.presetsRow}>
                  <Pressable
                    onPress={() => applyDatePreset('yesterday')}
                    style={[
                      styles.presetChip,
                      presetSelected === 'yesterday' && styles.presetChipActive,
                    ]}>
                    <Text
                      style={[
                        styles.presetChipText,
                        presetSelected === 'yesterday' && styles.presetChipTextActive,
                      ]}>
                      Yesterday
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => applyDatePreset('7d')}
                    style={[
                      styles.presetChip,
                      presetSelected === '7d' && styles.presetChipActive,
                    ]}>
                    <Text
                      style={[
                        styles.presetChipText,
                        presetSelected === '7d' && styles.presetChipTextActive,
                      ]}>
                      Past 7 Days
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => applyDatePreset('30d')}
                    style={[
                      styles.presetChip,
                      presetSelected === '30d' && styles.presetChipActive,
                    ]}>
                    <Text
                      style={[
                        styles.presetChipText,
                        presetSelected === '30d' && styles.presetChipTextActive,
                      ]}>
                      Past 30 Days
                    </Text>
                  </Pressable>
                </View>

                {/* Date Input Fields */}
                <View style={styles.dateInputsContainer}>
                  <View style={styles.dateField}>
                    <Text style={styles.dateFieldLabel}>From Date</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Pick from date from calendar"
                      onPress={() => {
                        setViewDate(parseYMD(startDateStr));
                        setCalendarTarget('start');
                      }}
                      style={styles.dateInputBox}>
                      <Icon
                        color="#00376f"
                        name={{ ios: 'calendar', android: 'event', web: 'event' }}
                        size={18}
                      />
                      <Text style={styles.dateValueText}>{startDateStr}</Text>
                      <Icon
                        color="#94a3b8"
                        name={{ ios: 'chevron.down', android: 'arrow_drop_down', web: 'arrow_drop_down' }}
                        size={18}
                      />
                    </Pressable>
                  </View>

                  <View style={styles.dateField}>
                    <Text style={styles.dateFieldLabel}>To Date</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Pick to date from calendar"
                      onPress={() => {
                        setViewDate(parseYMD(endDateStr));
                        setCalendarTarget('end');
                      }}
                      style={styles.dateInputBox}>
                      <Icon
                        color="#00376f"
                        name={{ ios: 'calendar', android: 'event', web: 'event' }}
                        size={18}
                      />
                      <Text style={styles.dateValueText}>{endDateStr}</Text>
                      <Icon
                        color="#94a3b8"
                        name={{ ios: 'chevron.down', android: 'arrow_drop_down', web: 'arrow_drop_down' }}
                        size={18}
                      />
                    </Pressable>
                  </View>
                </View>

                {/* Info Note about Today's date exclusion */}
                <View style={styles.infoBanner}>
                  <Icon
                    color="#00376f"
                    name={{
                      ios: 'info.circle.fill',
                      android: 'info',
                      web: 'info',
                    }}
                    size={16}
                  />
                  <Text style={styles.infoBannerText}>
                    Reports cover finalized historical data. Today's live submissions are excluded.
                  </Text>
                </View>

                {/* Selected Organizations Summary Pill */}
                <View style={styles.summaryPill}>
                  <Icon
                    color="#475569"
                    name={{
                      ios: 'building.2',
                      android: 'business',
                      web: 'business',
                    }}
                    size={15}
                  />
                  <Text style={styles.summaryPillText}>
                    {selectedOrgIds.size} organization{selectedOrgIds.size > 1 ? 's' : ''} selected
                  </Text>
                </View>
              </ScrollView>

              {/* Step 2 Footer Actions */}
              <View style={[styles.footerRow, { gap: 12 }]}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isExporting}
                  onPress={() => {
                    scrollOffsetRef.current = 0;
                    setStep(1);
                  }}
                  style={styles.secondaryButton}>
                  <Icon
                    color="#475569"
                    name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }}
                    size={16}
                  />
                  <Text style={styles.secondaryButtonText}>Back</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  disabled={isExporting}
                  onPress={handleExport}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { flex: 1 },
                    isExporting && styles.buttonDisabled,
                    pressed && { opacity: 0.8 },
                  ]}>
                  {isExporting ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <>
                      <Icon
                        color="#ffffff"
                        name={{
                          ios: 'square.and.arrow.up',
                          android: 'share',
                          web: 'share',
                        }}
                        size={18}
                        weight="bold"
                      />
                      <Text style={styles.primaryButtonText}>Export Excel (.xlsx)</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </Animated.View>

        {/* Calendar Picker Modal Overlay */}
        {Boolean(calendarTarget) && (
          <View style={styles.calendarOverlay}>
            <Pressable
              accessibilityLabel="Dismiss calendar"
              onPress={() => setCalendarTarget(null)}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.calendarCard}>
              {/* Header */}
              <View style={styles.calendarHeaderRow}>
                <View>
                  <Text style={styles.calendarModalTitle}>
                    {calendarTarget === 'start' ? 'Select Start Date' : 'Select End Date'}
                  </Text>
                  <Text style={styles.calendarModalSub}>Historical past dates only</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setCalendarTarget(null)}
                  style={styles.calendarCloseBtn}>
                  <Icon
                    color="#64748b"
                    name={{ ios: 'xmark', android: 'close', web: 'close' }}
                    size={18}
                  />
                </Pressable>
              </View>

              {/* Month Navigator */}
              <View style={styles.monthNavRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={goToPrevMonth}
                  style={styles.navBtn}>
                  <Icon
                    color="#00376f"
                    name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
                    size={18}
                  />
                </Pressable>
                <Text style={styles.monthLabel}>
                  {MONTH_NAMES[viewMonth]} {viewYear}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={!canGoNextMonth}
                  onPress={goToNextMonth}
                  style={[styles.navBtn, !canGoNextMonth && { opacity: 0.3 }]}>
                  <Icon
                    color="#00376f"
                    name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                    size={18}
                  />
                </Pressable>
              </View>

              {/* Weekday headers */}
              <View style={styles.weekdaysRow}>
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
                  <Text key={d} style={styles.weekdayText}>
                    {d}
                  </Text>
                ))}
              </View>

              {/* Day cells grid */}
              <View style={styles.daysGrid}>
                {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                  <View key={`empty_${i}`} style={styles.dayCell} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                  const dStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const isSelected =
                    calendarTarget === 'start'
                      ? dStr === startDateStr
                      : dStr === endDateStr;
                  const isTodayOrFuture = dStr >= todayStr;
                  const isInvalidRange =
                    calendarTarget === 'start'
                      ? dStr > endDateStr
                      : dStr < startDateStr;
                  const isDisabled = isTodayOrFuture || isInvalidRange;

                  return (
                    <View key={`day_${d}`} style={styles.dayCell}>
                      <Pressable
                        disabled={isDisabled}
                        onPress={() => handleSelectCalendarDay(d)}
                        style={[
                          styles.dayTouch,
                          isSelected && styles.dayTouchSelected,
                          isDisabled && styles.dayTouchDisabled,
                        ]}>
                        <Text
                          style={[
                            styles.dayText,
                            isSelected && styles.dayTextSelected,
                            isDisabled && styles.dayTextDisabled,
                          ]}>
                          {d}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>

              {/* Done button */}
              <Pressable
                accessibilityRole="button"
                onPress={() => setCalendarTarget(null)}
                style={styles.calendarDoneBtn}>
                <Text style={styles.calendarDoneBtnText}>Done</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  container: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '85%',
    maxWidth: 500,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 10,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  dragHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#cbd5e1',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleActive: {
    backgroundColor: '#00376f',
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  stepNumberActive: {
    color: '#ffffff',
  },
  stepLine: {
    width: 50,
    height: 2,
    backgroundColor: '#e2e8f0',
    marginHorizontal: 8,
  },
  stepLineActive: {
    backgroundColor: '#00376f',
  },
  stepContent: {
    flex: 1,
    gap: 12,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
    padding: 0,
  },
  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  checkboxTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  checkboxChecked: {
    backgroundColor: '#00376f',
    borderColor: '#00376f',
  },
  selectAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  orgList: {
    flex: 1,
  },
  orgListScroll: {
    gap: 8,
    paddingBottom: 8,
  },
  orgItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  orgItemSelected: {
    borderColor: '#00376f',
    backgroundColor: 'rgba(0, 55, 111, 0.04)',
  },
  orgItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    paddingRight: 8,
  },
  orgAvatar: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgAvatarSelected: {
    backgroundColor: 'rgba(0, 55, 111, 0.1)',
  },
  orgItemName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1e293b',
    flex: 1,
  },
  orgItemNameSelected: {
    fontWeight: '600',
    color: '#00376f',
  },
  loadingBox: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748b',
  },
  emptyBox: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#94a3b8',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    marginTop: 'auto',
  },
  primaryButton: {
    backgroundColor: '#00376f',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 8,
    flex: 1,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  secondaryButton: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 6,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    marginTop: 4,
  },
  presetsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  presetChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  presetChipActive: {
    backgroundColor: 'rgba(0, 55, 111, 0.08)',
    borderColor: '#00376f',
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  presetChipTextActive: {
    color: '#00376f',
    fontWeight: '700',
  },
  dateInputsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  dateField: {
    flex: 1,
    gap: 6,
  },
  dateFieldLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748b',
  },
  dateInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  dateValueText: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
    fontWeight: '600',
  },
  calendarOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 9999,
    elevation: 20,
  },
  calendarCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 18,
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 10,
  },
  calendarHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  calendarModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  calendarModalSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  calendarCloseBtn: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
  },
  monthNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  monthLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#00376f',
  },
  navBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  weekdaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 6,
  },
  weekdayText: {
    width: 38,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 2,
  },
  dayTouch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayTouchSelected: {
    backgroundColor: '#00376f',
  },
  dayTouchDisabled: {
    opacity: 0.25,
  },
  dayText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1e293b',
  },
  dayTextSelected: {
    color: '#ffffff',
    fontWeight: '700',
  },
  dayTextDisabled: {
    color: '#94a3b8',
  },
  calendarDoneBtn: {
    marginTop: 12,
    backgroundColor: '#00376f',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  calendarDoneBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f9ff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bae6fd',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    marginTop: 4,
  },
  infoBannerText: {
    fontSize: 12,
    color: '#0369a1',
    flex: 1,
    lineHeight: 16,
  },
  summaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
    alignSelf: 'flex-start',
  },
  summaryPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
});
