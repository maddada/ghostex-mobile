/**
 * The Tailscale connection fields (`.field-name`, `.field-address`,
 * `.field-username`, `.field-password` in mobile-04-tailscale.html) and the
 * generic labelled `FormField` every other section of the form is built from.
 */

import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { TailscaleFormCopy } from '../../copy';
import { SetupPalette } from '../../theme/palette';
import { formStyles } from './styles';

export type FormFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  mono?: boolean;
  multiline?: boolean;
  secureTextEntry?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
};

export function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  mono = false,
  multiline = false,
  secureTextEntry = false,
  keyboardType,
  autoCapitalize = 'none',
}: FormFieldProps) {
  return (
    <View style={formStyles.field}>
      {label.length > 0 ? <Text style={formStyles.fieldLabel}>{label}</Text> : null}
      <TextInput
        style={[
          formStyles.input,
          mono ? formStyles.inputMono : null,
          multiline ? formStyles.inputMultiline : null,
          error !== undefined ? formStyles.inputError : null,
        ]}
        placeholder={placeholder}
        placeholderTextColor={SetupPalette.DIM}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        spellCheck={false}
      />
      {error !== undefined ? (
        <Text style={formStyles.fieldError}>{error}</Text>
      ) : hint !== undefined ? (
        <Text style={formStyles.fieldHint}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function NameField({
  value,
  onChangeText,
  hint = true,
}: {
  value: string;
  onChangeText: (value: string) => void;
  hint?: boolean;
}) {
  return (
    <FormField
      label={TailscaleFormCopy.fields.name}
      value={value}
      onChangeText={onChangeText}
      placeholder={TailscaleFormCopy.fields.namePlaceholder}
      hint={hint ? TailscaleFormCopy.fields.nameHint : undefined}
      autoCapitalize="words"
    />
  );
}

export type TailscaleFieldsProps = {
  address: string;
  onAddressChange: (value: string) => void;
  addressError?: string;
  username: string;
  onUsernameChange: (value: string) => void;
  usernameError?: string;
  password: string;
  onPasswordChange: (value: string) => void;
  passwordError?: string;
  /** Editing a saved machine: a blank password keeps the stored one. */
  editing: boolean;
  /** Tailscale SSH is on, so the password is not used. */
  passwordDisabled?: boolean;
};

export default function TailscaleFields({
  address,
  onAddressChange,
  addressError,
  username,
  onUsernameChange,
  usernameError,
  password,
  onPasswordChange,
  passwordError,
  editing,
  passwordDisabled = false,
}: TailscaleFieldsProps) {
  const copy = TailscaleFormCopy.fields;
  return (
    <>
      <FormField
        label={copy.address}
        value={address}
        onChangeText={onAddressChange}
        placeholder={copy.addressPlaceholder}
        hint={copy.addressHint}
        error={addressError}
        mono
        keyboardType="url"
      />
      <FormField
        label={copy.username}
        value={username}
        onChangeText={onUsernameChange}
        placeholder={copy.usernamePlaceholder}
        error={usernameError}
        mono
      />
      {passwordDisabled ? null : (
        <FormField
          label={copy.password}
          value={password}
          onChangeText={onPasswordChange}
          placeholder={editing ? copy.passwordPlaceholderEdit : copy.passwordPlaceholder}
          hint={copy.passwordHint}
          error={passwordError}
          secureTextEntry
        />
      )}
    </>
  );
}

/** The bare Easy Connect pairing address, for the legacy "paste the address" add path. */
export function PairingAddressField({
  value,
  onChangeText,
  error,
}: {
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
}) {
  return (
    <FormField
      label={TailscaleFormCopy.fields.pairingAddress}
      value={value}
      onChangeText={onChangeText}
      placeholder={TailscaleFormCopy.fields.pairingAddressPlaceholder}
      hint={TailscaleFormCopy.fields.pairingAddressHint}
      error={error}
      mono
      multiline
    />
  );
}
