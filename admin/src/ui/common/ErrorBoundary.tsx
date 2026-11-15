import { Component } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Center, Code, Group, Stack, Text } from '@mantine/core';

interface Props {
  readonly children: ReactNode;
  /** Changing the key (e.g. the route) clears a previous error. */
  readonly resetKey?: string;
}

interface State {
  readonly error: Error | null;
  readonly resetKey: string | undefined;
}

/** Shows a friendly message instead of a blank screen when a page crashes. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <Center p="xl">
        <Stack maw={560} gap="sm">
          <Alert color="red" title="Что-то пошло не так">
            <Text size="sm">Неопубликованные правки сохранены в черновике — они не потеряются.</Text>
            <Code block mt="sm">{this.state.error.message}</Code>
          </Alert>
          <Group>
            <Button onClick={this.reset}>Попробовать снова</Button>
            <Button variant="default" onClick={() => window.location.reload()}>Перезагрузить страницу</Button>
          </Group>
        </Stack>
      </Center>
    );
  }
}
