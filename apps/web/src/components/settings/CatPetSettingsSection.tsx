/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code setting, English only: upstream's catalogs stay untouched */
import {
  CAT_PET_SIZES,
  DEFAULT_CAT_PET_SETTINGS,
  type CatPetSettings,
  type CatPetStatus,
} from "@t3tools/contracts";
import { CAT_PET_SIZE_LABELS, catPetDisplayWidth } from "@t3tools/shared/catPetSprite";
import { type CSSProperties, useEffect, useState } from "react";

import { CatPetSprite } from "../../catPet/CatPetSprite";
import { updateCatPetSettings } from "../../catPet/startCatPet";
import { type CatPetChoice, useCatPetChoices } from "../../catPet/useCatPets";
import { isElectron } from "../../env";
import { useClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

function Choice<T extends string>(props: {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<readonly [T, string]>;
  readonly disabled?: boolean;
  readonly onChange: (value: T) => void;
}) {
  const current = props.options.find(([value]) => value === props.value)?.[1] ?? props.value;
  return (
    <div className="w-full sm:w-48">
      <Select
        disabled={props.disabled ?? false}
        value={props.value}
        onValueChange={(next) => {
          const match = props.options.find(([value]) => value === next);
          if (match !== undefined) props.onChange(match[0]);
        }}
      >
        <SelectTrigger size="sm" className="w-full min-w-0" aria-label={props.label}>
          <SelectValue>{current}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {props.options.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

/** A range input in the style of the other Appearance sliders, with its value beside it. */
function Slider(props: {
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly value: number;
  readonly text: string;
  readonly valueText: string;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}) {
  const ratio = (props.value - props.min) / (props.max - props.min);
  const style = {
    "--settings-slider-progress": `${ratio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - ratio}rem`,
  } as CSSProperties;
  return (
    <div className="flex w-full items-center gap-3 sm:w-52">
      <output
        className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
        htmlFor={props.id}
      >
        {props.text}
      </output>
      <input
        aria-label={props.label}
        aria-valuetext={props.valueText}
        className="settings-slider min-w-0 flex-1"
        disabled={props.disabled}
        id={props.id}
        max={props.max}
        min={props.min}
        onChange={(event) => {
          const value = Number(event.currentTarget.value);
          if (Number.isInteger(value) && value >= props.min && value <= props.max) {
            props.onChange(value);
          }
        }}
        step={1}
        style={style}
        type="range"
        value={props.value}
      />
    </div>
  );
}

function Toggle(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <Switch
      checked={props.checked}
      disabled={props.disabled ?? false}
      onCheckedChange={(checked) => props.onChange(Boolean(checked))}
      aria-label={props.label}
    />
  );
}

function PetPicker(props: {
  readonly settings: CatPetSettings;
  readonly pets: readonly CatPetChoice[] | null;
  readonly reduced: boolean;
  readonly onRefresh: () => void;
}) {
  const { pets } = props;
  if (pets === null) return <p className="text-muted-foreground text-xs">Loading pets…</p>;
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Pet" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {pets.map((pet) => {
          const selected = pet.id === props.settings.petId;
          return (
            <button
              key={pet.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={pet.displayName}
              onClick={() => void updateCatPetSettings({ petId: pet.id, petPicked: true })}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors",
                selected ? "border-primary bg-accent" : "border-border hover:bg-accent/50",
              )}
            >
              <CatPetSprite
                spec={pet.spec}
                sheetUrl={pet.sheetUrl}
                state={selected ? "working" : "idle"}
                width={96}
                reduced={props.reduced}
              />
              <span className="font-medium">{pet.displayName}</span>
              {pet.source !== "built-in" ? (
                <span className="text-muted-foreground">
                  {pet.source === "codex" ? "~/.codex/pets" : "~/.catcode/pets"}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {isElectron && props.settings.customPets ? (
        <div>
          <Button size="xs" variant="outline" onClick={props.onRefresh}>
            Look for new pets
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The chosen pet at the chosen size and opacity; hovering shows her fully, as on the desktop. */
function PetPreview(props: {
  readonly settings: CatPetSettings;
  readonly pets: readonly CatPetChoice[] | null;
  readonly reduced: boolean;
}) {
  const [hover, setHover] = useState(false);
  const pet =
    props.pets?.find((choice) => choice.id === props.settings.petId) ?? props.pets?.[0] ?? null;
  if (pet === null) return null;
  return (
    <div
      className="flex min-h-28 items-end justify-center overflow-hidden rounded-lg border bg-muted/40 p-3"
      data-testid="cat-pet-preview"
    >
      <div
        className="transition-opacity duration-200"
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        style={hover ? undefined : { opacity: props.settings.opacity / 100 }}
      >
        <CatPetSprite
          spec={pet.spec}
          sheetUrl={pet.sheetUrl}
          state="idle"
          width={catPetDisplayWidth(props.settings.size, pet.spec.imageRendering)}
          reduced={props.reduced}
        />
      </div>
    </div>
  );
}

const placementText = (status: CatPetStatus | null, settings: CatPetSettings) => {
  if (!settings.enabled) return "Off.";
  if (!isElectron || status?.placement === "in-app") {
    return status?.reason ?? "She sits in a corner of the app window.";
  }
  return "She floats over your other apps and never takes focus. Drag her anywhere.";
};

/** The desktop pet: Settings > Appearance > Pet. */
export function CatPetSettingsSection() {
  const settings = useClientSettings((s) => s.catPet);
  const [checked, setChecked] = useState<{ key: string; status: CatPetStatus } | null>(null);
  const statusKey = JSON.stringify(settings);
  const status = checked?.status ?? null;
  const [shortcutDraft, setShortcutDraft] = useState<string | null>(null);
  const update = (patch: Partial<CatPetSettings>) => void updateCatPetSettings(patch);
  const off = !settings.enabled;
  const reducedPreview = settings.motion === "reduced";
  const [refresh, setRefresh] = useState(0);
  const pets = useCatPetChoices(isElectron && settings.customPets, refresh);
  const sizeIndex = Math.max(0, CAT_PET_SIZES.indexOf(settings.size));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Asks the desktop app where the pet ended up and whether its shortcut registered, after each change.
  useEffect(() => {
    const bridge = window.catgirlPet;
    if (bridge === undefined) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void bridge
        .getStatus()
        .then((next) => {
          if (!cancelled) setChecked({ key: statusKey, status: next });
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [statusKey]);

  const commitShortcut = () => {
    if (shortcutDraft === null) return;
    update({ shortcut: shortcutDraft.trim() });
    setShortcutDraft(null);
  };
  const isDefault = statusKey === JSON.stringify(DEFAULT_CAT_PET_SETTINGS);

  return (
    <SettingsSection id="appearance-pet" title="Pet">
      <SettingsRow
        title="Desktop pet"
        description={placementText(status, settings)}
        resetAction={
          isDefault ? null : (
            <SettingResetButton
              ariaLabel="Reset all pet settings to default"
              onClick={() => update(DEFAULT_CAT_PET_SETTINGS)}
            />
          )
        }
        control={
          <Toggle
            label="Show the pet"
            checked={settings.enabled}
            onChange={(enabled) => update({ enabled })}
          />
        }
      />
      <SettingsRow title="Pet" description="Pick who keeps you company. Previews are live.">
        <div className="px-3 pb-3 sm:px-4">
          <PetPicker
            settings={settings}
            pets={pets}
            reduced={reducedPreview}
            onRefresh={() => setRefresh((value) => value + 1)}
          />
        </div>
      </SettingsRow>
      <SettingsRow
        title="Size"
        description="Pixel pets keep whole-pixel sizes to stay crisp, so Meowtase is the same at XS and S."
        control={
          <Slider
            id="cat-pet-size"
            label="Pet size"
            min={0}
            max={CAT_PET_SIZES.length - 1}
            value={sizeIndex}
            text={settings.size.toUpperCase()}
            valueText={CAT_PET_SIZE_LABELS[settings.size]}
            disabled={off}
            onChange={(index) => update({ size: CAT_PET_SIZES[index] ?? settings.size })}
          />
        }
      />
      <SettingsRow
        title="Opacity"
        description="How solid she is while you're not using her. She shows fully when you point at her, drag her or open her bubble, and when a thread needs you."
        control={
          <Slider
            id="cat-pet-opacity"
            label="Pet opacity"
            min={1}
            max={100}
            value={settings.opacity}
            text={`${settings.opacity}%`}
            valueText={`${settings.opacity} percent`}
            disabled={off}
            onChange={(opacity) => update({ opacity })}
          />
        }
      />
      <SettingsRow title="Preview" description="Point at her to see her fully.">
        <div className="px-3 pb-3 sm:px-4">
          <PetPreview settings={settings} pets={pets} reduced={reducedPreview} />
        </div>
      </SettingsRow>
      <SettingsRow
        title="Show"
        description="When nothing is running she can tuck herself away."
        control={
          <Choice
            label="When to show the pet"
            value={settings.showWhen}
            disabled={off}
            options={[
              ["always", "Always"],
              ["busy", "Only while agents are busy"],
            ]}
            onChange={(showWhen) => update({ showWhen })}
          />
        }
      />
      {isElectron ? (
        <>
          <SettingsRow
            title="Where"
            description="On Wayland she always sits in the app window."
            control={
              <Choice
                label="Where the pet sits"
                value={settings.placement}
                disabled={off}
                options={[
                  ["desktop", "Float over other apps"],
                  ["in-app", "Inside the app window"],
                ]}
                onChange={(placement) => update({ placement })}
              />
            }
          />
          <SettingsRow
            title="Hide while Catgirl Code is focused"
            description="She only floats while you're in other apps."
            control={
              <Toggle
                label="Hide the pet while Catgirl Code is focused"
                checked={settings.hideWhenAppFocused}
                disabled={off}
                onChange={(hideWhenAppFocused) => update({ hideWhenAppFocused })}
              />
            }
          />
          <SettingsRow
            title="Over full-screen apps"
            description="macOS only. Off keeps her out of videos and presentations."
            control={
              <Toggle
                label="Show the pet over full-screen apps"
                checked={settings.overFullScreen}
                disabled={off}
                onChange={(overFullScreen) => update({ overFullScreen })}
              />
            }
          />
        </>
      ) : null}
      <SettingsRow
        title="Motion"
        description="Reduced shows a still pose for each mood. System follows your OS setting."
        control={
          <Choice
            label="Pet motion"
            value={settings.motion}
            disabled={off}
            options={[
              ["system", "System"],
              ["reduced", "Reduced"],
              ["full", "Full"],
            ]}
            onChange={(motion) => update({ motion })}
          />
        }
      />
      <SettingsRow
        title="Thread titles in the bubble"
        description="Off shows counts and machines only, for screen sharing."
        control={
          <Toggle
            label="Show thread titles in the pet's bubble"
            checked={settings.showTitles}
            disabled={off}
            onChange={(showTitles) => update({ showTitles })}
          />
        }
      />
      {isElectron ? (
        <>
          <SettingsRow
            title="Shortcut"
            description={
              status?.shortcut === "unavailable"
                ? "That shortcut is taken or not valid. Try another, such as Control+Alt+P."
                : "A global shortcut that hides and shows her, such as Control+Alt+P. Empty for none."
            }
            control={
              <div className="w-full sm:w-48">
                <Input
                  size="sm"
                  disabled={off}
                  aria-label="Pet shortcut"
                  placeholder="None"
                  value={shortcutDraft ?? settings.shortcut}
                  onChange={(event) => setShortcutDraft(event.currentTarget.value)}
                  onBlur={commitShortcut}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitShortcut();
                  }}
                />
              </div>
            }
          />
          <SettingsRow
            title="Custom pets"
            description="Load Codex-format pets from ~/.catcode/pets and ~/.codex/pets."
            control={
              <Toggle
                label="Load custom pets"
                checked={settings.customPets}
                disabled={off}
                onChange={(customPets) => update({ customPets })}
              />
            }
          />
        </>
      ) : null}
    </SettingsSection>
  );
}
