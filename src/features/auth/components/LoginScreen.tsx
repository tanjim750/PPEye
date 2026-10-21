import { Image } from "expo-image";
import { Href, useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/ui/Icon";
import { assets } from "@/constants/assets";
import { isLoginTestMode } from "@/constants/devMode";
import { login } from "@/features/auth/services/auth.service";
import { authStore } from "@/stores/auth.store";

export function LoginScreen() {
  const router = useRouter();
  const { t } = useTranslation(["auth", "common"]);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function performLogin(user: {
    id: string | number;
    email: string;
    name?: string;
    role: "vendor" | "reviewer" | "external" | "internal" | "admin";
    category?: "INTERNAL" | "EXTERNAL";
    externalType?: "PROJECT_MANAGER" | "TEAM_LEADER" | "WORKER";
    vendorProfileId?: number;
    vendorName?: string;
    projectName?: string;
    designation?: string;
    phone?: string;
  }) {
    setErrorMessage(null);
    authStore.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      category: user.category,
      externalType: user.externalType,
      vendorProfileId: user.vendorProfileId,
      vendorName: user.vendorName,
      projectName: user.projectName,
      designation: user.designation,
      phone: user.phone,
    };

    router.replace(
      (user.role === "vendor" || user.role === "external" ? "/(external)" : "/(internal)") as Href,
    );
  }

  async function handleLogin() {
    const cleanUsername = username.trim().toLowerCase();
    const cleanPassword = password.trim();
    if (isSubmitting) return;
    setErrorMessage(null);

    if (isLoginTestMode) {
      const { dummyUsers } = await import("@/utils/dummy-users");
      const demoUser = dummyUsers.find((item) => {
        const id = item.username.toLowerCase();
        const idMatches =
          id === cleanUsername ||
          cleanUsername === `${id}@example.com` ||
          cleanUsername === `${id}@ppeye.com` ||
          cleanUsername === `${id}@gmail.com` ||
          (item.phone && cleanUsername === item.phone.replace(/[^0-9+]/g, "")) ||
          item.role === cleanUsername;
        return idMatches && (item.password === cleanPassword || cleanPassword === "123456" || cleanPassword === `${id}123`);
      });

      if (demoUser) {
        performLogin({ ...demoUser, id: demoUser.username, email: `${demoUser.username}@example.com` });
        return;
      }
    }

    if (!cleanUsername.includes("@")) {
      const msg = isLoginTestMode
        ? "Test credentials did not match. Enter a valid account email to sign in with Supabase Auth."
        : "Enter the email address associated with your account.";
      setErrorMessage(msg);
      Alert.alert("Sign In", msg);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await login({ email: cleanUsername, password: cleanPassword });
      performLogin(result.user);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign in failed.";
      setErrorMessage(message);
      Alert.alert("Sign In Error", message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleForgotPassword() {
    router.push("/forgot-password" as Href);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardAvoid}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.logoFrame}>
              <Image source={assets.logo} style={styles.logo} />
            </View>

            <View style={styles.copy}>
              <Text style={styles.title}>{t("auth:loginScreen.title")}</Text>
              <Text style={styles.description}>{t("auth:loginScreen.description")}</Text>
            </View>
          </View>

          <View style={styles.form}>
            {errorMessage ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t("auth:loginScreen.emailOrPhone")}</Text>
              <View style={styles.inputShell}>
                <Icon
                  color={colors.outline}
                  name={{ ios: "envelope", android: "mail", web: "mail" }}
                  size={20}
                  style={styles.inputIcon}
                />
                <TextInput
                  autoCapitalize="none"
                  keyboardType="email-address"
                  onChangeText={(val) => {
                    setUsername(val);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder={t("auth:loginScreen.emailOrPhonePlaceholder")}
                  placeholderTextColor={colors.outline}
                  style={styles.input}
                  value={username}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.passwordLabelRow}>
                <Text style={styles.label}>{t("auth:loginScreen.password")}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleForgotPassword}
                  style={({ pressed }) => pressed && styles.textPressed}
                >
                  {/* <Text style={styles.forgotText}>{t('auth:loginScreen.forgotPassword')}</Text> */}
                </Pressable>
              </View>

              <View style={styles.inputShell}>
                <Icon
                  color={colors.outline}
                  name={{ ios: "lock", android: "lock", web: "lock" }}
                  size={20}
                  style={styles.inputIcon}
                />
                <TextInput
                  autoCapitalize="none"
                  onChangeText={(val) => {
                    setPassword(val);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  returnKeyType="done"
                  placeholder={t("auth:loginScreen.passwordPlaceholder")}
                  placeholderTextColor={colors.outline}
                  secureTextEntry={!isPasswordVisible}
                  style={[styles.input, styles.passwordInput]}
                  value={password}
                />
                <Pressable
                  accessibilityLabel={t("auth:loginScreen.togglePasswordVisibility")}
                  accessibilityRole="button"
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  onPress={() => setIsPasswordVisible((v) => !v)}
                  style={({ pressed }) => [styles.eyeButton, pressed && styles.textPressed]}
                >
                  <Icon
                    color={colors.outline}
                    name={{
                      ios: isPasswordVisible ? "eye.slash" : "eye",
                      android: isPasswordVisible ? "visibility_off" : "visibility",
                      web: isPasswordVisible ? "visibility_off" : "visibility",
                    }}
                    size={22}
                  />
                </Pressable>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={handleLogin}
              style={({ pressed }) => [
                styles.loginButton,
                pressed && styles.pressed,
                isSubmitting && styles.loginButtonDisabled,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Text style={styles.loginText}>{t("auth:loginScreen.submit")}</Text>
                  <Icon
                    color={colors.white}
                    name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }}
                    size={16}
                    weight="semibold"
                  />
                </>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.adminCopy}>
              {t("auth:loginScreen.needAccess")}{" "}
              <Text style={styles.adminLink}>{t("auth:loginScreen.contactAdmin")}</Text>
            </Text>
            <Text style={styles.version}>{t("common:version", { version: "1.0.0" })}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const colors = {
  background: "#f9f9ff",
  outline: "#717785",
  primary: "#005cad",
  primaryFixed: "#d5e3ff",
  surfaceContainerLow: "#f1f3fd",
  text: "#181c22",
  textMuted: "#404753",
  white: "#ffffff",
  error: "#ba1a1a",
  errorContainer: "#ffdad6",
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoid: {
    flex: 1,
    paddingHorizontal: 20,
  },
  scrollContent: {
    alignSelf: "center",
    flexGrow: 1,
    gap: 36,
    justifyContent: "space-between",
    paddingVertical: 24,
    width: "100%",
    maxWidth: 448,
  },
  header: {
    alignItems: "center",
    gap: 16,
  },
  logoFrame: {
    alignItems: "center",
    backgroundColor: colors.primaryFixed,
    borderRadius: 12,
    height: 64,
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    width: 64,
  },
  logo: {
    borderRadius: 12,
    height: 64,
    width: 64,
  },
  copy: {
    alignItems: "center",
    gap: 4,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 32,
    textAlign: "center",
  },
  description: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  form: {
    gap: 24,
  },
  errorContainer: {
    backgroundColor: colors.errorContainer,
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: "500",
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 16,
  },
  passwordLabelRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  forgotText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  inputShell: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 12,
    flexDirection: "row",
    minHeight: 48,
    paddingLeft: 16,
  },
  inputIcon: {
    height: 20,
    width: 28,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 48,
    paddingRight: 16,
  },
  passwordInput: {
    paddingRight: 92,
  },
  eyeButton: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
    position: "absolute",
    right: 0,
    zIndex: 99,
    elevation: 5,
  },
  loginButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    height: 48,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  textPressed: {
    opacity: 0.68,
  },
  footer: {
    alignItems: "center",
    gap: 16,
  },
  adminCopy: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  adminLink: {
    color: colors.primary,
    fontWeight: "600",
  },
  version: {
    color: colors.outline,
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 14,
    textAlign: "center",
  },
});
